import { randomUUID } from 'node:crypto';
import { Order } from '../../database/entities/order.entity';
import { OrderItem } from '../../database/entities/order-item.entity';
import {
  countQueries,
  createTestDb,
  seedOrder,
  TestDb,
} from '../../test-helpers';
import { OrderService } from './order.service';

// POSTGRES THẬT. Chạy: docker compose up -d postgres && npm run test:int -w services/order -- order.service
// Processing_Flow §3: chỉ đọc order_db, số truy vấn không đổi theo số đơn.

jest.setTimeout(60_000);

describe('OrderService (Postgres thật)', () => {
  let db: TestDb;
  let service: OrderService;

  beforeAll(async () => {
    db = await createTestDb();
    service = new OrderService(
      db.ds.getRepository(Order),
      db.ds.getRepository(OrderItem),
    );
  });
  afterAll(async () => db?.cleanup());
  beforeEach(async () => {
    await db.ds.query('TRUNCATE orders CASCADE');
  });
  afterEach(() => jest.restoreAllMocks());

  it('ẩn failed khi không lọc; lọc failed thì thấy; chỉ đơn của mình', async () => {
    const me = randomUUID();
    await seedOrder(db.ds, { user_id: me, status: 'pending' });
    await seedOrder(db.ds, { user_id: me, status: 'failed' });
    await seedOrder(db.ds, { user_id: me, status: 'processing' });
    await seedOrder(db.ds, { user_id: randomUUID(), status: 'pending' });

    const all = await service.findMine(me, {});
    expect(all.total).toBe(2);
    expect(all.items.map((o) => o.status).sort()).toEqual([
      'pending',
      'processing',
    ]);

    const failed = await service.findMine(me, { status: 'failed' });
    expect(failed.items.map((o) => o.status)).toEqual(['failed']);
  });

  it('phân trang ổn định khi trùng created_at (created_at DESC, id DESC)', async () => {
    const me = randomUUID();
    const same = new Date('2026-11-20T00:00:00Z');
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push(
        await seedOrder(db.ds, {
          user_id: me,
          status: 'paid',
          created_at: same,
        }),
      );
    }

    const p1 = await service.findMine(me, { page: 1, limit: 2 });
    const p2 = await service.findMine(me, { page: 2, limit: 2 });
    const p3 = await service.findMine(me, { page: 3, limit: 2 });
    const seen = [...p1.items, ...p2.items, ...p3.items].map((o) => o.id);

    expect(seen).toEqual([...ids].sort().reverse());
    expect(p1.totalPages).toBe(3);
  });

  it('GET /api/orders: số truy vấn không đổi theo số đơn (≤ 3: count + đơn + dòng đơn)', async () => {
    const me = randomUUID();
    await seedOrder(db.ds, { user_id: me, status: 'paid', lines: [{}] });

    let q = countQueries();
    await service.findMine(me, {});
    const one = q.count;
    q.restore();

    for (let i = 0; i < 9; i++) {
      await seedOrder(db.ds, {
        user_id: me,
        status: 'paid',
        lines: [{}, {}],
      });
    }
    q = countQueries();
    const res = await service.findMine(me, {});
    const ten = q.count;
    q.restore();

    q = countQueries();
    await service.findMine(me, { limit: 5 });
    const fullPage = q.count;
    q.restore();

    expect(res.items).toHaveLength(10);
    // Trang đầu chưa đầy: TypeORM bỏ câu count (biết tổng = số dòng) → 2. Trang đầy → 3. Ngưỡng 4.
    expect({ one, ten, fullPage }).toEqual({ one: 2, ten: 2, fullPage: 3 });
  });

  it('GET /api/orders/:id: snapshot tên, ảnh, giá; ≤ 3 truy vấn', async () => {
    const me = randomUUID();
    const id = await seedOrder(db.ds, {
      user_id: me,
      status: 'pending',
      payment_expires_at: new Date('2026-11-20T01:15:00Z'),
      lines: [
        {
          product_name: 'Tai nghe X',
          product_image: 'https://img/p.jpg',
          unit_price: 150000,
          quantity: 2,
        },
      ],
    });

    const q = countQueries();
    const res = await service.findOneMine(me, id);
    const n = q.count;
    q.restore();

    expect(res.items[0]).toMatchObject({
      product: {
        name: 'Tai nghe X',
        price: '150000',
        image: 'https://img/p.jpg',
      },
      quantity: 2,
    });
    expect(res.payment_expires_at).toEqual(new Date('2026-11-20T01:15:00Z'));
    expect(n).toBeLessThanOrEqual(3);
  });

  it('đơn người khác → 404 NT-ORD-1006', async () => {
    const id = await seedOrder(db.ds, {
      user_id: randomUUID(),
      status: 'paid',
    });
    await expect(service.findOneMine(randomUUID(), id)).rejects.toMatchObject({
      code: 'NT-ORD-1006',
    });
  });
});
