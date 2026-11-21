import type { ConfigService } from '@nestjs/config';
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
import { CompensationService } from '../checkout/compensation.service';
import { OrderCancelService } from '../checkout/order-cancel.service';
import { PaymentCoreService } from '../payment/payment-core.service';
import { PaymentLedgerService } from '../payment/payment-ledger.service';
import { AdminOrderService } from './order.admin.service';

// POSTGRES THẬT. Chạy: docker compose up -d postgres && npm run test:int -w services/order -- order.admin
// findAll, findOne (QueryBuilder, subquery product_count, quan hệ payment) và updateStatus trên schema thật.
// T3.5: admin huỷ qua OrderCancelService thật (client giả) — NT.CHECKOUT_SAGA test 32, 6 truy vấn khi đủ (v1.7).

jest.setTimeout(60_000);

describe('AdminOrderService (Postgres thật)', () => {
  let db: TestDb;
  let service: AdminOrderService;
  const catalog = { release: jest.fn() };
  const promotion = { release: jest.fn() };

  beforeAll(async () => {
    db = await createTestDb();
    const compensation = new CompensationService(
      db.ds.getRepository(Order),
      db.ds.getRepository(SagaTask),
      db.ds,
      catalog as unknown as CatalogClient,
      promotion as unknown as PromotionClient,
    );
    const paymentCore = new PaymentCoreService(
      db.ds,
      new PaymentLedgerService(db.ds),
    );
    const orderCancel = new OrderCancelService(
      db.ds,
      compensation,
      paymentCore,
      {
        getOrThrow: () => ({ budgetMs: 8000 }),
      } as unknown as ConfigService,
    );
    service = new AdminOrderService(
      db.ds.getRepository(Order),
      db.ds,
      orderCancel,
      paymentCore,
    );
  });
  afterAll(async () => db?.cleanup());
  beforeEach(async () => {
    jest.clearAllMocks();
    await db.ds.query('TRUNCATE orders CASCADE');
    catalog.release.mockResolvedValue({ status: 'released', restored: true });
    promotion.release.mockResolvedValue({ status: 'released', restored: true });
  });
  afterEach(() => jest.restoreAllMocks());

  it('findAll: tìm theo snapshot customer_name, product_count = tổng số lượng, 2 truy vấn', async () => {
    await seedOrder(db.ds, {
      user_id: randomUUID(),
      status: 'paid',
      customer_name: 'Trần Thị Bình',
      lines: [{ quantity: 2 }, { quantity: 3 }],
    });
    await seedOrder(db.ds, {
      user_id: randomUUID(),
      status: 'pending',
      customer_name: 'Lê Văn C',
      lines: [{ quantity: 1 }],
    });

    const q = countQueries();
    const res = await service.findAll({ search: 'bình' });
    const n = q.count;
    q.restore();

    expect(res.total).toBe(1);
    expect(res.items[0]).toMatchObject({
      user_name: 'Trần Thị Bình',
      product_count: 5,
      status: 'paid',
      total: '230000',
    });
    expect(n).toBe(2);
  });

  it('findAll: lọc status, from/to; trả cả failed (admin thấy mọi đơn như be/)', async () => {
    await seedOrder(db.ds, {
      user_id: randomUUID(),
      status: 'failed',
      created_at: new Date('2026-11-10T00:00:00Z'),
    });
    await seedOrder(db.ds, {
      user_id: randomUUID(),
      status: 'paid',
      created_at: new Date('2026-11-15T00:00:00Z'),
    });

    expect((await service.findAll({})).total).toBe(2);
    expect((await service.findAll({ status: 'failed' })).total).toBe(1);
    expect(
      (await service.findAll({ from: '2026-11-12T00:00:00Z' })).items.map(
        (o) => o.status,
      ),
    ).toEqual(['paid']);
  });

  it('findOne: user từ snapshot, kèm payment, 1–3 truy vấn', async () => {
    const userId = randomUUID();
    const id = await seedOrder(db.ds, {
      user_id: userId,
      status: 'paid',
      customer_name: 'Nguyễn A',
      lines: [{ product_name: 'Sạc', unit_price: 50000 }],
    });
    await db.ds.query(
      `INSERT INTO payments (order_id, method, amount, status) VALUES ($1, 'payos', 230000, 'success')`,
      [id],
    );

    const q = countQueries();
    const res = await service.findOne(id);
    const n = q.count;
    q.restore();

    expect(res.user).toEqual({
      id: userId,
      full_name: 'Nguyễn A',
      email: 'a@b.c',
      phone_number: '0900000000',
    });
    expect(res.items[0].product).toMatchObject({ name: 'Sạc', price: '50000' });
    expect(res.payment).toMatchObject({ method: 'payos', status: 'success' });
    expect(res.payment_expires_at).toBeNull();
    expect(n).toBeLessThanOrEqual(3);
  });

  it('updateStatus paid → shipped ghi DB; ≤ 6 truy vấn', async () => {
    const id = await seedOrder(db.ds, {
      user_id: randomUUID(),
      status: 'paid',
    });

    const q = countQueries();
    const res = await service.updateStatus(id, { status: 'shipped' });
    const n = q.count;
    q.restore();

    expect(res).toMatchObject({ id, status: 'shipped' });
    const [row] = await db.ds.query<Array<{ status: string }>>(
      `SELECT status FROM orders WHERE id = $1`,
      [id],
    );
    expect(row.status).toBe('shipped');
    expect(n).toBeLessThanOrEqual(6);
  });

  it('updateStatus shipped → cancelled: 400 NT-ORD-1007, DB không đổi', async () => {
    const id = await seedOrder(db.ds, {
      user_id: randomUUID(),
      status: 'shipped',
    });

    await expect(
      service.updateStatus(id, { status: 'cancelled' }),
    ).rejects.toMatchObject({ code: 'NT-ORD-1007' });
    const [row] = await db.ds.query<Array<{ status: string }>>(
      `SELECT status FROM orders WHERE id = $1`,
      [id],
    );
    expect(row.status).toBe('shipped');
  });

  it.each(['pending', 'paid'])(
    'test 32: admin huỷ đơn %s → cancelled, task done, nhả kho; paid giữ giao dịch success; 5 truy vấn ở T3.6 (có voidPendingByOrder)',
    async (from) => {
      const id = await seedOrder(db.ds, {
        user_id: randomUUID(),
        status: from,
      });
      if (from === 'paid') {
        await db.ds.query(
          `INSERT INTO payments (order_id, method, amount, status) VALUES ($1, 'payos', 230000, 'success')`,
          [id],
        );
      }

      const q = countQueries();
      const res = await service.updateStatus(id, { status: 'cancelled' });
      const n = q.count;
      q.restore();

      expect(res).toMatchObject({ id, status: 'cancelled' });
      expect(res.updated_at).toBeInstanceOf(Date);
      const [row] = await db.ds.query<Array<{ status: string }>>(
        `SELECT status FROM orders WHERE id = $1`,
        [id],
      );
      expect(row.status).toBe('cancelled');
      const tasks = await db.ds
        .getRepository(SagaTask)
        .findBy({ order_id: id });
      expect(tasks.map((t) => `${t.type}:${t.status}`)).toEqual([
        'release_stock:done',
      ]);
      expect(catalog.release).toHaveBeenCalledWith(id, {
        deadline: expect.any(Number) as unknown,
      });
      if (from === 'paid') {
        const [p] = await db.ds.query<Array<{ status: string }>>(
          `SELECT status FROM payments WHERE order_id = $1`,
          [id],
        );
        expect(p.status).toBe('success'); // hoàn tiền tay (be/)
      }
      expect(n).toBe(5);
    },
  );

  it('giao đơn COD (pending → shipped): giao dịch success cùng transaction; ≤ 6 truy vấn (T3.6)', async () => {
    const id = await seedOrder(db.ds, {
      user_id: randomUUID(),
      status: 'pending',
    });
    await db.ds.query(
      `INSERT INTO payments (order_id, method, amount, status) VALUES ($1, 'cod', 230000, 'pending')`,
      [id],
    );

    const q = countQueries();
    const res = await service.updateStatus(id, { status: 'shipped' });
    const n = q.count;
    q.restore();

    expect(res).toMatchObject({ id, status: 'shipped' });
    const [row] = await db.ds.query<
      Array<{ o: string; p: string; paid: Date | null }>
    >(
      `SELECT o.status AS o, p.status AS p, p.paid_at AS paid FROM orders o JOIN payments p ON p.order_id = o.id WHERE o.id = $1`,
      [id],
    );
    expect(row.o).toBe('shipped');
    expect(row.p).toBe('success');
    expect(row.paid).toBeInstanceOf(Date);
    expect(n).toBeLessThanOrEqual(6);
  });
});
