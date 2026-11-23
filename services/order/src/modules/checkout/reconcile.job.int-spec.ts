import type { ConfigService } from '@nestjs/config';
import { UpstreamBusinessError, UpstreamError } from '@nextech/service-kit';
import { randomUUID } from 'node:crypto';
import type { CatalogClient } from '../../clients/catalog.client';
import type { IdentityClient } from '../../clients/identity.client';
import type { PromotionClient } from '../../clients/promotion.client';
import { Cart } from '../../database/entities/cart.entity';
import { Order } from '../../database/entities/order.entity';
import { OrderItem } from '../../database/entities/order-item.entity';
import { SagaTask } from '../../database/entities/saga-task.entity';
import { countQueries, createTestDb, TestDb, noHold } from '../../test-helpers';
import { CheckoutSagaService } from './checkout-saga.service';
import { CheckoutService } from './checkout.service';
import { CompensationService } from './compensation.service';
import { ReconcileJob } from './reconcile.job';

// POSTGRES THẬT, client giả. Chạy: docker compose up -d postgres && npm run test:int -w services/order -- reconcile
// NT.CHECKOUT_SAGA Component_Class_Design §7 (v1.7), §8 test 10 (cron), 11, 12, 22, 30. Đơn kẹt tạo bằng
// checkout thật (giữ kho timeout → 202), rồi lùi updated_at thay vì chờ 15 giây.

jest.setTimeout(60_000);

const CFG = {
  shippingFee: 30000,
  freeShippingThreshold: 500000,
  budgetMs: 8000,
  deadlineMs: 120000,
};

describe('ReconcileJob (Postgres thật)', () => {
  let db: TestDb;
  let service: CheckoutService;
  let job: ReconcileJob;
  const P1 = randomUUID();
  const P2 = randomUUID();

  const identity = { getAddress: jest.fn(), getUser: jest.fn() };
  const catalog = {
    getProducts: jest.fn(),
    reserve: jest.fn(),
    release: jest.fn(),
  };
  const promotion = { redeem: jest.fn(), release: jest.fn() };

  beforeAll(async () => {
    db = await createTestDb();
    const orders = db.ds.getRepository(Order);
    const compensation = new CompensationService(
      orders,
      db.ds.getRepository(SagaTask),
      db.ds,
      catalog as unknown as CatalogClient,
      promotion as unknown as PromotionClient,
    );
    const saga = new CheckoutSagaService(
      orders,
      db.ds,
      catalog as unknown as CatalogClient,
      promotion as unknown as PromotionClient,
      compensation,
      noHold,
    );
    service = new CheckoutService(
      db.ds.getRepository(Cart),
      orders,
      db.ds,
      identity as unknown as IdentityClient,
      catalog as unknown as CatalogClient,
      saga,
      { getOrThrow: () => CFG } as unknown as ConfigService,
    );
    job = new ReconcileJob(
      db.ds,
      db.ds.getRepository(OrderItem),
      saga,
      compensation,
      {
        getOrThrow: () => ({ resilienceEnabled: true }),
      } as unknown as ConfigService,
    );
  });
  afterAll(async () => db?.cleanup());

  beforeEach(async () => {
    jest.clearAllMocks();
    await db.ds.query('TRUNCATE orders, carts CASCADE');
    identity.getAddress.mockImplementation((userId: string, id: string) =>
      Promise.resolve({
        id,
        user_id: userId,
        full_address: '1 Lê Lợi, Q1',
        recipient_name: 'Nguyễn A',
        phone_number: '0900000001',
      }),
    );
    identity.getUser.mockImplementation((id: string) =>
      Promise.resolve({
        id,
        email: 'a@b.c',
        full_name: 'Nguyễn Văn A',
        phone_number: '0900000000',
      }),
    );
    catalog.getProducts.mockResolvedValue([
      { id: P1, name: 'Tai nghe', price: 150000, is_active: true, image: 'i1' },
      { id: P2, name: 'Cáp', price: 50000, is_active: true, image: null },
    ]);
    catalog.reserve.mockResolvedValue({ status: 'reserved' });
    catalog.release.mockResolvedValue({ status: 'released', restored: true });
    promotion.release.mockResolvedValue({ status: 'released', restored: true });
  });
  afterEach(() => jest.restoreAllMocks());

  const timeout = (t: string) =>
    new UpstreamError(t, 'timeout', 'unknown', 504);
  const refused = (t: string) =>
    new UpstreamError(t, 'ECONNREFUSED', 'not_executed');
  const outOfStock = () =>
    new UpstreamBusinessError('catalog', 409, 'NT-CAT-1001', 'Hết hàng');

  async function seedCart(
    userId: string,
    lines: Array<[string, number]>,
  ): Promise<void> {
    const [{ id: cartId }] = await db.ds.query<Array<{ id: string }>>(
      'INSERT INTO carts (user_id) VALUES ($1) RETURNING id',
      [userId],
    );
    for (const [productId, qty] of lines) {
      await db.ds.query(
        'INSERT INTO cart_items (cart_id, product_id, quantity) VALUES ($1, $2, $3)',
        [cartId, productId, qty],
      );
    }
  }
  const orderOf = async (userId: string) =>
    await db.ds.getRepository(Order).findOneByOrFail({ user_id: userId });
  const cartLines = async (userId: string) =>
    (
      await db.ds.query<Array<{ n: string }>>(
        'SELECT count(*) AS n FROM cart_items ci JOIN carts c ON c.id = ci.cart_id WHERE c.user_id = $1',
        [userId],
      )
    )[0].n;
  const tasksOf = (orderId: string) =>
    db.ds
      .getRepository(SagaTask)
      .find({ where: { order_id: orderId }, order: { seq: 'ASC' } });
  // Lùi updated_at như thể không ai đụng vào đơn trong `seconds` giây
  const age = (id: string, seconds: number) =>
    db.ds.query(
      `UPDATE orders SET updated_at = LOCALTIMESTAMP - $2::int * interval '1 second' WHERE id = $1`,
      [id, seconds],
    );
  const updatedAt = async (id: string) =>
    (
      await db.ds.query<Array<{ updated_at: Date }>>(
        'SELECT updated_at FROM orders WHERE id = $1',
        [id],
      )
    )[0].updated_at;

  // Đơn processing/started như sau một 202 (giữ kho timeout): request đã trả, chỉ cron làm tiếp
  async function stuckOrder(u: string, key?: string): Promise<Order> {
    await seedCart(u, [
      [P1, 2],
      [P2, 1],
    ]);
    catalog.reserve.mockRejectedValueOnce(timeout('catalog'));
    const r = await service.checkout(u, { address_id: randomUUID() }, key);
    expect(r.status).toBe(202);
    jest.clearAllMocks();
    return orderOf(u);
  }

  // Đơn compensating vì nhả kho lỗi lúc request (giữ kho 409)
  async function compensatingOrder(u: string): Promise<Order> {
    await seedCart(u, [[P1, 1]]);
    catalog.reserve.mockRejectedValueOnce(outOfStock());
    catalog.release.mockRejectedValueOnce(refused('catalog'));
    await service.checkout(u, { address_id: randomUUID() }).catch(() => null);
    const o = await orderOf(u);
    expect(o.saga_step).toBe('compensating');
    jest.clearAllMocks();
    return o;
  }

  it('test 11: đơn started quá 15 giây, catalog khoẻ → tick → pending, giữ kho đủ dòng, xoá dòng giỏ', async () => {
    const u = randomUUID();
    const o = await stuckOrder(u);
    await age(o.id, 20);

    await job.tick();

    expect(await orderOf(u)).toMatchObject({
      status: 'pending',
      saga_step: 'confirmed',
    });
    expect(catalog.reserve).toHaveBeenCalledTimes(1);
    const [orderId, items] = catalog.reserve.mock.calls[0] as [
      string,
      Array<{ product_id: string; quantity: number }>,
    ];
    expect(orderId).toBe(o.id);
    // items gắn từ câu đọc lô, đúng số lượng
    expect(
      items
        .map((i) => `${i.product_id === P1 ? 'P1' : 'P2'}x${i.quantity}`)
        .sort(),
    ).toEqual(['P1x2', 'P2x1']);
    expect(await cartLines(u)).toBe('0');
  });

  it('chọn đơn kẹt: 2 câu (UPDATE … SKIP LOCKED RETURNING, items cả lô) cho 3 đơn', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const o = await stuckOrder(randomUUID());
      await age(o.id, 20);
      ids.push(o.id);
    }
    // Chỉ đo câu chọn: advance từng đơn tách riêng
    const advance = jest
      .spyOn(CheckoutSagaService.prototype, 'advance')
      .mockResolvedValue({ kind: 'in_doubt' } as never);

    const q = countQueries();
    await job.tick();
    const n = q.count;
    q.restore();

    expect(advance).toHaveBeenCalledTimes(3);
    // bước 1: 2 câu; bước 2, 3: mỗi bước 1 câu chọn
    expect(n).toBe(4);
  });

  it('đơn mới hơn 15 giây → không bị đụng (tránh đua với request đang chạy)', async () => {
    const u = randomUUID();
    await stuckOrder(u);

    await job.tick();

    expect(catalog.reserve).not.toHaveBeenCalled();
    expect((await orderOf(u)).status).toBe('processing');
  });

  it('test 30: catalog vẫn timeout → giữ processing, updated_at đặt lại, tick kế không chọn lại', async () => {
    const u = randomUUID();
    const o = await stuckOrder(u);
    await age(o.id, 20);
    const before = await updatedAt(o.id);
    catalog.reserve.mockRejectedValue(timeout('catalog'));

    await job.tick();
    await job.tick();

    expect(catalog.reserve).toHaveBeenCalledTimes(1);
    expect(await orderOf(u)).toMatchObject({
      status: 'processing',
      saga_step: 'started',
    });
    expect((await updatedAt(o.id)).getTime()).toBeGreaterThan(before.getTime());
  });

  it('test 12: quá saga_deadline → hoàn tác, failed/compensated, NT-GEN-0504, nhả kho, nhả key', async () => {
    const u = randomUUID();
    const o = await stuckOrder(u, 'key-12');
    await db.ds.query(
      `UPDATE orders SET saga_deadline = now() - interval '1 second' WHERE id = $1`,
      [o.id],
    );
    await age(o.id, 20);

    await job.tick();

    expect(catalog.reserve).not.toHaveBeenCalled();
    expect(catalog.release).toHaveBeenCalledTimes(1);
    expect(await orderOf(u)).toMatchObject({
      status: 'failed',
      saga_step: 'compensated',
      failure_code: 'NT-GEN-0504',
      failure_status: 504,
      failure_message: 'Đặt hàng quá thời gian xử lý, vui lòng thử lại',
      idempotency_key: null,
    });
  });

  it('test 10 (cron): nhả kho lỗi lúc request → tick khi catalog sống lại → failed, attempts giữ 1', async () => {
    const u = randomUUID();
    const o = await compensatingOrder(u);

    await job.tick();

    expect(catalog.release).toHaveBeenCalledTimes(1);
    expect(await orderOf(u)).toMatchObject({
      status: 'failed',
      saga_step: 'compensated',
    });
    expect((await tasksOf(o.id))[0]).toMatchObject({
      status: 'done',
      attempts: 1,
    });
  });

  it('task nhả vẫn lỗi → attempts tăng mỗi lượt, đơn giữ compensating', async () => {
    const u = randomUUID();
    const o = await compensatingOrder(u);
    catalog.release.mockRejectedValue(refused('catalog'));

    await job.tick();
    await job.tick();

    expect((await tasksOf(o.id))[0]).toMatchObject({
      status: 'pending',
      attempts: 3,
    });
    expect((await orderOf(u)).saga_step).toBe('compensating');
  });

  it('test 22: task đã done nhưng đơn còn compensating (finish lỗi) → tick bước 3 → failed, không nhả lại', async () => {
    const u = randomUUID();
    const o = await compensatingOrder(u);
    await db.ds.query(
      `UPDATE saga_tasks SET status = 'done', done_at = now() WHERE order_id = $1`,
      [o.id],
    );
    await age(o.id, 20);

    await job.tick();

    expect(catalog.release).not.toHaveBeenCalled();
    expect(await orderOf(u)).toMatchObject({
      status: 'failed',
      saga_step: 'compensated',
    });
  });

  it('đơn compensating hết task nhưng mới hơn 15 giây → bước 3 chưa chốt', async () => {
    const u = randomUUID();
    const o = await compensatingOrder(u);
    await db.ds.query(
      `UPDATE saga_tasks SET status = 'done' WHERE order_id = $1`,
      [o.id],
    );

    await job.tick();

    expect((await orderOf(u)).saga_step).toBe('compensating');
  });

  it('đơn cancelled có task tồn (huỷ lúc catalog chết) → tick nhả, đơn vẫn cancelled', async () => {
    const u = randomUUID();
    await seedCart(u, [[P1, 1]]);
    const r = await service.checkout(u, { address_id: randomUUID() });
    await db.ds.query(`UPDATE orders SET status = 'cancelled' WHERE id = $1;`, [
      r.body.id,
    ]);
    await db.ds.query(
      `INSERT INTO saga_tasks (order_id, type, seq) VALUES ($1, 'release_stock', 2)`,
      [r.body.id],
    );
    jest.clearAllMocks();

    await job.tick();

    expect(catalog.release).toHaveBeenCalledWith(r.body.id, {
      deadline: undefined,
    });
    expect((await tasksOf(r.body.id))[0].status).toBe('done');
    expect((await orderOf(u)).status).toBe('cancelled');
  });

  it('hai tick chồng nhau (hai bản order) → mỗi đơn chỉ được làm tiếp một lần (SKIP LOCKED)', async () => {
    const u = randomUUID();
    const o = await stuckOrder(u);
    await age(o.id, 20);
    const other = new ReconcileJob(
      db.ds,
      db.ds.getRepository(OrderItem),
      (job as unknown as { saga: CheckoutSagaService }).saga,
      (job as unknown as { compensation: CompensationService }).compensation,
      {
        getOrThrow: () => ({ resilienceEnabled: true }),
      } as unknown as ConfigService,
    );

    await Promise.all([job.tick(), other.tick()]);

    expect(catalog.reserve).toHaveBeenCalledTimes(1);
    expect((await orderOf(u)).status).toBe('pending');
  });
});
