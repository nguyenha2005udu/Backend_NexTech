import { randomUUID } from 'node:crypto';
import type { CatalogClient } from '../../clients/catalog.client';
import type { IdentityClient } from '../../clients/identity.client';
import { Order } from '../../database/entities/order.entity';
import {
  countQueries,
  createTestDb,
  noLock,
  seedOrder,
  TestDb,
  noHold,
} from '../../test-helpers';
import { PaymentCoreService } from '../payment/payment-core.service';
import { PaymentLedgerService } from '../payment/payment-ledger.service';
import { AdminStatisticsService } from './statistics.admin.service';

// POSTGRES THẬT. Chạy: docker compose up -d postgres && npm run test:int -w services/order -- statistics.admin
// NT.ORDER v1.7 mục GET /api/admin/statistics/overview: đơn lọc created_at, doanh thu lọc paid_at của giao dịch
// success (như be/ getOverview); 3 truy vấn order_db. Client catalog, identity giả (đường lỗi ở unit spec).

jest.setTimeout(60_000);

describe('AdminStatisticsService.getOverview (Postgres thật)', () => {
  let db: TestDb;
  let service: AdminStatisticsService;
  const catalog = {
    stats: jest.fn(() =>
      Promise.resolve({ total_products: 40, active_products: 35 }),
    ),
  };
  const identity = {
    stats: jest.fn(() => Promise.resolve({ total_users: 7 })),
  };

  beforeAll(async () => {
    db = await createTestDb();
    const core = new PaymentCoreService(
      db.ds,
      new PaymentLedgerService(db.ds),
      noLock,
      noHold,
    );
    service = new AdminStatisticsService(
      db.ds.getRepository(Order),
      core,
      catalog as unknown as CatalogClient,
      identity as unknown as IdentityClient,
    );
  });
  afterAll(async () => db?.cleanup());
  beforeEach(async () => {
    await db.ds.query('TRUNCATE orders CASCADE');
  });

  async function seed(
    status: string,
    createdAt: string,
    pay?: { status: string; amount: number; paidAt: string | null },
  ) {
    const orderId = await seedOrder(db.ds, {
      user_id: randomUUID(),
      status,
      created_at: new Date(createdAt),
    });
    if (pay) {
      await db.ds.query(
        `INSERT INTO payments (order_id, method, transaction_id, amount, status, paid_at)
         VALUES ($1, 'payos', $2, $3, $4, $5)`,
        [
          orderId,
          String(Math.floor(Math.random() * 1e9)),
          pay.amount,
          pay.status,
          pay.paidAt,
        ],
      );
    }
    return orderId;
  }

  async function seedSample() {
    await seed('paid', '2026-10-15', {
      status: 'success',
      amount: 100000,
      paidAt: '2026-10-15',
    });
    await seed('paid', '2026-11-05', {
      status: 'success',
      amount: 230000,
      paidAt: '2026-11-05',
    });
    await seed('pending', '2026-11-06', {
      status: 'pending',
      amount: 999000,
      paidAt: null,
    });
    await seed('cancelled', '2026-11-07', {
      status: 'failed',
      amount: 500000,
      paidAt: null,
    });
    await seed('pending', '2026-11-08');
  }

  const byStatus = (rows: Array<{ status: string; count: number }>) =>
    Object.fromEntries(rows.map((r) => [r.status, r.count]));

  it('không lọc: đếm mọi đơn, nhóm theo trạng thái (count là số), doanh thu chỉ success; 3 truy vấn', async () => {
    await seedSample();
    const q = countQueries();
    const r = await service.getOverview({});
    const queries = q.count;
    q.restore();

    expect(r.total_orders).toBe(5);
    expect(byStatus(r.orders_by_status)).toEqual({
      paid: 2,
      pending: 2,
      cancelled: 1,
    });
    expect(typeof r.orders_by_status[0].count).toBe('number');
    expect(r.total_revenue).toBe(330000);
    expect(r).toMatchObject({
      total_products: 40,
      active_products: 35,
      total_users: 7,
      unavailable: [],
    });
    expect(queries).toBe(3);
  });

  it('from/to: đơn lọc created_at, doanh thu lọc paid_at (như be/)', async () => {
    await seedSample();
    const r = await service.getOverview({
      from: '2026-11-01',
      to: '2026-11-30',
    });
    expect(r.total_orders).toBe(4);
    expect(byStatus(r.orders_by_status)).toEqual({
      paid: 1,
      pending: 2,
      cancelled: 1,
    });
    expect(r.total_revenue).toBe(230000);
  });

  it('không có đơn → 0, orders_by_status rỗng', async () => {
    const r = await service.getOverview({});
    expect(r.total_orders).toBe(0);
    expect(r.orders_by_status).toEqual([]);
    expect(r.total_revenue).toBe(0);
  });
});
