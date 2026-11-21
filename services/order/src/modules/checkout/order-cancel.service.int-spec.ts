import type { ConfigService } from '@nestjs/config';
import { UpstreamError } from '@nextech/service-kit';
import { randomUUID } from 'node:crypto';
import type { CatalogClient } from '../../clients/catalog.client';
import type { PromotionClient } from '../../clients/promotion.client';
import { Order } from '../../database/entities/order.entity';
import { SagaTask } from '../../database/entities/saga-task.entity';
import {
  countQueries,
  createTestDb,
  seedOrder,
  TestDb,
} from '../../test-helpers';
import { CompensationService } from './compensation.service';
import { OrderCancelService } from './order-cancel.service';

// POSTGRES THẬT, client giả. Chạy: docker compose up -d postgres && npm run test:int -w services/order -- order-cancel
// NT.CHECKOUT_SAGA Component_Class_Design §7.1, §8 test 17, 18, 31; số truy vấn Processing_Flow §5 (v1.7):
// ở T3.5 (chưa voidPendingByOrder, outbox) là 4; đường lỗi: mỗi task lỗi một câu ghi lỗi thay/thêm câu done.

jest.setTimeout(60_000);

describe('OrderCancelService (Postgres thật)', () => {
  let db: TestDb;
  let compensation: CompensationService;
  const catalog = { release: jest.fn() };
  const promotion = { release: jest.fn() };
  const make = (budgetMs = 8000) =>
    new OrderCancelService(db.ds, compensation, {
      getOrThrow: () => ({ budgetMs }),
    } as unknown as ConfigService);
  let service: OrderCancelService;

  beforeAll(async () => {
    db = await createTestDb();
    compensation = new CompensationService(
      db.ds.getRepository(Order),
      db.ds.getRepository(SagaTask),
      db.ds,
      catalog as unknown as CatalogClient,
      promotion as unknown as PromotionClient,
    );
    service = make();
  });
  afterAll(async () => db?.cleanup());
  beforeEach(async () => {
    jest.clearAllMocks();
    await db.ds.query('TRUNCATE orders CASCADE');
    catalog.release.mockResolvedValue({ status: 'released', restored: true });
    promotion.release.mockResolvedValue({ status: 'released', restored: true });
  });
  afterEach(() => jest.restoreAllMocks());

  const refused = (target: string) =>
    new UpstreamError(target, 'ECONNREFUSED', 'not_executed');
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function pendingOrder(userId: string, discountCode?: string) {
    const id = await seedOrder(db.ds, { user_id: userId, status: 'pending' });
    await db.ds.query(
      `UPDATE orders SET saga_step = 'confirmed', discount_code = $2 WHERE id = $1`,
      [id, discountCode ?? null],
    );
    return id;
  }
  const orderRow = async (id: string) =>
    (
      await db.ds.query<
        Array<{ status: string; saga_step: string; updated_at: Date }>
      >('SELECT status, saga_step, updated_at FROM orders WHERE id = $1', [id])
    )[0];
  const tasksOf = (orderId: string) =>
    db.ds.getRepository(SagaTask).find({
      where: { order_id: orderId },
      order: { seq: 'ASC' },
    });

  it('huỷ đơn pending → { id, cancelled, updated_at } khớp DB, nhả kho ngay, task done; 4 truy vấn', async () => {
    const u = randomUUID();
    const id = await pendingOrder(u);

    const q = countQueries();
    const res = await service.cancelByUser(u, id);
    const n = q.count;
    q.restore();

    const row = await orderRow(id);
    expect(res).toEqual({
      id,
      status: 'cancelled',
      updated_at: row.updated_at,
    });
    expect(row).toMatchObject({ status: 'cancelled', saga_step: 'confirmed' });
    expect(catalog.release).toHaveBeenCalledTimes(1);
    expect(promotion.release).not.toHaveBeenCalled();
    expect(await tasksOf(id)).toEqual([
      expect.objectContaining({ type: 'release_stock', status: 'done' }),
    ]);
    expect(n).toBe(4);
  });

  it('có mã → nhả mã rồi nhả kho, cả hai done', async () => {
    const u = randomUUID();
    const id = await pendingOrder(u, 'SALE10');
    const calls: string[] = [];
    promotion.release.mockImplementation(() => {
      calls.push('promotion');
      return Promise.resolve({});
    });
    catalog.release.mockImplementation(() => {
      calls.push('catalog');
      return Promise.resolve({});
    });

    await service.cancelByUser(u, id);

    expect(calls).toEqual(['promotion', 'catalog']);
    expect((await tasksOf(id)).map((t) => t.status)).toEqual(['done', 'done']);
  });

  it('test 17: catalog lỗi → vẫn 200 cancelled, task còn pending attempts 1; cron chạy lại → done, đơn vẫn cancelled; 4 truy vấn (câu ghi lỗi thay câu done)', async () => {
    const u = randomUUID();
    const id = await pendingOrder(u);
    catalog.release.mockRejectedValueOnce(refused('catalog'));

    const q = countQueries();
    const res = await service.cancelByUser(u, id);
    const n = q.count;
    q.restore();

    expect(res.status).toBe('cancelled');
    expect((await tasksOf(id))[0]).toMatchObject({
      status: 'pending',
      attempts: 1,
      last_error: 'catalog ECONNREFUSED (not_executed)',
    });
    expect(n).toBe(4);

    await compensation.run(id); // như ReconcileJob bước 2

    expect((await tasksOf(id))[0]).toMatchObject({ status: 'done' });
    expect((await orderRow(id)).status).toBe('cancelled');
  });

  it('đường lỗi xấu nhất: có mã, nhả kho lỗi, nhả mã xong → 5 truy vấn ở T3.5 (khi đủ T3.6, T4.1: 7)', async () => {
    const u = randomUUID();
    const id = await pendingOrder(u, 'SALE10');
    catalog.release.mockRejectedValueOnce(refused('catalog'));

    const q = countQueries();
    await service.cancelByUser(u, id);
    const n = q.count;
    q.restore();

    expect((await tasksOf(id)).map((t) => t.status)).toEqual([
      'done',
      'pending',
    ]);
    expect(n).toBe(5);
  });

  it('test 18: huỷ hai lần nối tiếp → lần hai 400 NT-ORD-1008, nhả một lần', async () => {
    const u = randomUUID();
    const id = await pendingOrder(u);
    await service.cancelByUser(u, id);

    await expect(service.cancelByUser(u, id)).rejects.toMatchObject({
      status: 400,
      code: 'NT-ORD-1008',
    });
    expect(catalog.release).toHaveBeenCalledTimes(1);
    expect(await tasksOf(id)).toHaveLength(1);
  });

  it('test 18: huỷ hai lần đồng thời → một thành công, một 400, một bộ task, nhả một lần (khoá dòng)', async () => {
    const u = randomUUID();
    const id = await pendingOrder(u);

    const results = await Promise.allSettled([
      service.cancelByUser(u, id),
      service.cancelByUser(u, id),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected');
    expect(rejected?.reason).toMatchObject({ code: 'NT-ORD-1008' });
    expect(await tasksOf(id)).toHaveLength(1);
    expect(catalog.release).toHaveBeenCalledTimes(1);
  });

  it('đơn của người khác → 404 NT-ORD-1006, không đổi', async () => {
    const id = await pendingOrder(randomUUID());
    await expect(service.cancelByUser(randomUUID(), id)).rejects.toMatchObject({
      status: 404,
      code: 'NT-ORD-1006',
    });
    expect((await orderRow(id)).status).toBe('pending');
  });

  it('đơn paid → 400 NT-ORD-1008, không tạo task (BR-06)', async () => {
    const u = randomUUID();
    const id = await seedOrder(db.ds, { user_id: u, status: 'paid' });
    await expect(service.cancelByUser(u, id)).rejects.toMatchObject({
      code: 'NT-ORD-1008',
    });
    expect(await tasksOf(id)).toHaveLength(0);
  });

  it('test 31: lệnh nhả chậm quá SAGA_BUDGET_MS → 200 trong ngân sách, task sau còn pending cho cron', async () => {
    const u = randomUUID();
    const id = await pendingOrder(u, 'SALE10');
    // Ngân sách 1,5 s, dừng khi còn dưới 1 s (API_Spec §5): nhả mã mất 0,7 s → không còn đủ cho nhả kho
    const slow = make(1500);
    promotion.release.mockImplementation(async () => {
      await sleep(700);
      return {};
    });

    const t0 = Date.now();
    const res = await slow.cancelByUser(u, id);
    const elapsed = Date.now() - t0;

    expect(res.status).toBe('cancelled');
    expect(elapsed).toBeLessThan(1500);
    expect(catalog.release).not.toHaveBeenCalled();
    expect((await tasksOf(id)).map((t) => `${t.type}:${t.status}`)).toEqual([
      'release_promotion:done',
      'release_stock:pending',
    ]);
  });
});
