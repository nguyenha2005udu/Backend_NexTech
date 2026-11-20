import { randomUUID } from 'node:crypto';
import { Order } from '../../database/entities/order.entity';
import {
  countQueries,
  createTestDb,
  seedOrder,
  TestDb,
} from '../../test-helpers';
import { AdminOrderService } from './order.admin.service';

// POSTGRES THẬT. Chạy: docker compose up -d postgres && npm run test:int -w services/order -- order.admin
// findAll, findOne (QueryBuilder, subquery product_count, quan hệ payment) và updateStatus trên schema thật.

jest.setTimeout(60_000);

describe('AdminOrderService (Postgres thật)', () => {
  let db: TestDb;
  let service: AdminOrderService;

  beforeAll(async () => {
    db = await createTestDb();
    service = new AdminOrderService(db.ds.getRepository(Order), db.ds);
  });
  afterAll(async () => db?.cleanup());
  beforeEach(async () => {
    await db.ds.query('TRUNCATE orders CASCADE');
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
});
