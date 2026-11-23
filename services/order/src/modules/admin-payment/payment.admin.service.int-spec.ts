import { randomUUID } from 'node:crypto';
import { Payment } from '../../database/entities/payment.entity';
import {
  countQueries,
  createTestDb,
  noLock,
  seedOrder,
  TestDb,
  noHold,
} from '../../test-helpers';
import { OrderLockBusyError } from '../../database/db-lock-error';
import type { OrderLockService } from '../../redis/order-lock.service';
import { RevenueService } from '../admin-revenue/revenue.admin.service';
import { PaymentCoreService } from '../payment/payment-core.service';
import { PaymentLedgerService } from '../payment/payment-ledger.service';
import { AdminPaymentService } from './payment.admin.service';

// POSTGRES THẬT. Chạy: docker compose up -d postgres && npm run test:int -w services/order -- payment.admin
// NT.PAYMENT API_Spec §1 route 4–7 (v2.7): danh sách (sắp created_at DESC, id DESC — sổ A11), chi tiết + transactions
// (không raw_payload, dedup_key, ≤ 3 truy vấn), confirm-cod, doanh thu (chép nguyên be/ getRevenueStats).

jest.setTimeout(60_000);

describe('AdminPaymentService + RevenueService (Postgres thật)', () => {
  let db: TestDb;
  let admin: AdminPaymentService;
  let revenue: RevenueService;
  let ledger: PaymentLedgerService;

  beforeAll(async () => {
    db = await createTestDb();
    ledger = new PaymentLedgerService(db.ds);
    const core = new PaymentCoreService(db.ds, ledger, noLock, noHold);
    admin = new AdminPaymentService(db.ds.getRepository(Payment), core, ledger);
    revenue = new RevenueService(db.ds.getRepository(Payment));
  });
  afterAll(async () => db?.cleanup());
  beforeEach(async () => {
    await db.ds.query('TRUNCATE orders CASCADE');
  });

  async function seedPayment(
    o: {
      method?: string;
      status?: string;
      createdAt?: string;
      paidAt?: string | null;
      code?: string | null;
    } = {},
  ) {
    const orderId = await seedOrder(db.ds, {
      user_id: randomUUID(),
      status: 'pending',
    });
    const [{ id }] = await db.ds.query<Array<{ id: string }>>(
      `INSERT INTO payments (order_id, method, transaction_id, amount, status, created_at, paid_at, gateway_response)
       VALUES ($1, $2, $3, 230000, $4, COALESCE($5::timestamp, now()), $6, '{"orderCode":1}') RETURNING id`,
      [
        orderId,
        o.method ?? 'payos',
        o.code === undefined ? String(Math.floor(Math.random() * 1e9)) : o.code,
        o.status ?? 'pending',
        o.createdAt ?? null,
        o.paidAt ?? null,
      ],
    );
    return { orderId, paymentId: id };
  }

  describe('findAll', () => {
    it('lọc method, status; shape be/; phân trang', async () => {
      await seedPayment({ method: 'cod', code: null });
      const b = await seedPayment({ status: 'success', paidAt: '2026-11-10' });
      const r = await admin.findAll({ method: 'payos', status: 'success' });
      expect(r).toMatchObject({ total: 1, page: 1, limit: 20, totalPages: 1 });
      expect(r.items[0]).toEqual({
        id: b.paymentId,
        order_id: b.orderId,
        method: 'payos',
        amount: '230000',
        status: 'success',
        paid_at: expect.any(Date) as unknown,
      });
    });

    it('trùng created_at → thứ tự ổn định theo id DESC, hai trang không lặp, không sót (A11); ≤ 4 truy vấn', async () => {
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) {
        ids.push(
          (await seedPayment({ createdAt: '2026-11-20 10:00:00' })).paymentId,
        );
      }
      const q = countQueries();
      const p1 = await admin.findAll({ page: 1, limit: 3 });
      const n = q.count;
      q.restore();
      const p2 = await admin.findAll({ page: 2, limit: 3 });
      const got = [...p1.items, ...p2.items].map((x) => x.id);
      expect(got).toEqual([...ids].sort().reverse());
      expect(n).toBeLessThanOrEqual(4);
    });
  });

  describe('findOne', () => {
    it('trường be/ + transactions (không raw_payload, dedup_key); ≤ 3 truy vấn', async () => {
      const s = await seedPayment({ code: '555' });
      const lid = await ledger.record(
        {
          orderCode: 555,
          amount: 230000,
          description: 'd',
          accountNumber: '1',
          reference: 'FT-ADMIN-1',
          transactionDateTime: '2026-11-21 10:00:00',
          currency: 'VND',
          paymentLinkId: 'pl',
          code: '00',
          desc: 'success',
          counterAccountName: 'NGUYEN VAN A',
          counterAccountNumber: '0123',
        },
        'sig',
      );
      await ledger.settle(lid, s.paymentId, 'applied');

      const q = countQueries();
      const r = await admin.findOne(s.paymentId);
      const n = q.count;
      q.restore();

      expect(r).toMatchObject({
        id: s.paymentId,
        order_id: s.orderId,
        method: 'payos',
        transaction_id: '555',
        amount: '230000',
        currency: 'VND',
        status: 'pending',
        gateway_response: { orderCode: 1 },
        paid_at: null,
      });
      expect(r.transactions).toHaveLength(1);
      expect(r.transactions[0]).toMatchObject({
        reference: 'FT-ADMIN-1',
        amount: '230000',
        counter_account_name: 'NGUYEN VAN A',
        outcome: 'applied',
      });
      expect(r.transactions[0]).not.toHaveProperty('raw_payload');
      expect(r.transactions[0]).not.toHaveProperty('dedup_key');
      expect(n).toBeLessThanOrEqual(3);
    });

    it('không có → 404 NT-PAY-1001', async () => {
      await expect(admin.findOne(randomUUID())).rejects.toMatchObject({
        status: 404,
        code: 'NT-PAY-1001',
      });
    });
  });

  it('confirmCod khi khoá đơn bận → 409 NT-ORD-1012, giao dịch vẫn pending (BR-20)', async () => {
    const busy = {
      withOrderLock: (id: string) => Promise.reject(new OrderLockBusyError(id)),
    } as unknown as OrderLockService;
    const a = new AdminPaymentService(
      db.ds.getRepository(Payment),
      new PaymentCoreService(db.ds, ledger, busy, noHold),
      ledger,
    );
    const s = await seedPayment({ method: 'cod', code: null });
    await expect(a.confirmCod(s.paymentId)).rejects.toMatchObject({
      status: 409,
      code: 'NT-ORD-1012',
    });
    const [p] = await db.ds.query<Array<{ status: string }>>(
      'SELECT status FROM payments WHERE id = $1',
      [s.paymentId],
    );
    expect(p.status).toBe('pending');
  });

  it('confirmCod → { id, status: success, paid_at }, đơn paid', async () => {
    const s = await seedPayment({ method: 'cod', code: null });
    const r = await admin.confirmCod(s.paymentId);
    expect(r).toEqual({
      id: s.paymentId,
      status: 'success',
      paid_at: expect.any(Date) as unknown,
    });
    const [o] = await db.ds.query<Array<{ status: string }>>(
      'SELECT status FROM orders WHERE id = $1',
      [s.orderId],
    );
    expect(o.status).toBe('paid');
  });

  describe('doanh thu (be/ getRevenueStats)', () => {
    it('theo tháng: tổng giao dịch success có paid_at, số đơn; bỏ pending', async () => {
      await seedPayment({ status: 'success', paidAt: '2026-10-05 10:00:00' });
      await seedPayment({ status: 'success', paidAt: '2026-11-05 10:00:00' });
      await seedPayment({ status: 'success', paidAt: '2026-11-20 10:00:00' });
      await seedPayment({ status: 'pending' });
      const q = countQueries();
      const r = await revenue.getRevenueStats({});
      const n = q.count;
      q.restore();
      expect(r).toEqual({
        group_by: 'month',
        items: [
          { period: '2026-10-01', revenue: 230000, order_count: 1 },
          { period: '2026-11-01', revenue: 460000, order_count: 2 },
        ],
      });
      expect(n).toBe(1);
    });

    it('theo tuần, lọc from/to', async () => {
      await seedPayment({ status: 'success', paidAt: '2026-11-05 10:00:00' });
      await seedPayment({ status: 'success', paidAt: '2026-11-20 10:00:00' });
      const r = await revenue.getRevenueStats({
        groupBy: 'week',
        from: '2026-11-15',
      });
      expect(r.group_by).toBe('week');
      expect(r.items).toEqual([
        { period: '2026-11-16', revenue: 230000, order_count: 1 },
      ]);
    });
  });
});
