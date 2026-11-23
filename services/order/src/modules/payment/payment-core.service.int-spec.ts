import type { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { EntityManager } from 'typeorm';
import type { CatalogClient } from '../../clients/catalog.client';
import type { PromotionClient } from '../../clients/promotion.client';
import { Order } from '../../database/entities/order.entity';
import { Payment } from '../../database/entities/payment.entity';
import { PaymentTransaction } from '../../database/entities/payment-transaction.entity';
import { SagaTask } from '../../database/entities/saga-task.entity';
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
import { CompensationService } from '../checkout/compensation.service';
import { OrderCancelService } from '../checkout/order-cancel.service';
import { PaymentCoreService } from './payment-core.service';
import {
  PaymentLedgerService,
  type WebhookPayload,
} from './payment-ledger.service';

// POSTGRES THẬT. Chạy: docker compose up -d postgres && npm run test:int -w services/order -- payment-core
// NT.PAYMENT Component_Class_Design §4, §4.1, §6 (v2.7): markSuccess một transaction (khoá đơn rồi giao dịch),
// BR-09, BR-10, mã cũ previous_transaction_ids, markFailed có điều kiện (B15), huỷ đua webhook, sổ tiền về.

jest.setTimeout(60_000);

describe('PaymentCoreService + PaymentLedgerService (Postgres thật)', () => {
  let db: TestDb;
  let core: PaymentCoreService;
  let ledger: PaymentLedgerService;
  let cancel: OrderCancelService;
  const catalog = { release: jest.fn() };
  const promotion = { release: jest.fn() };

  beforeAll(async () => {
    db = await createTestDb();
    ledger = new PaymentLedgerService(db.ds);
    core = new PaymentCoreService(db.ds, ledger, noLock, noHold);
    const compensation = new CompensationService(
      db.ds.getRepository(Order),
      db.ds.getRepository(SagaTask),
      db.ds,
      catalog as unknown as CatalogClient,
      promotion as unknown as PromotionClient,
    );
    cancel = new OrderCancelService(
      db.ds,
      compensation,
      core,
      { getOrThrow: () => ({ budgetMs: 8000 }) } as unknown as ConfigService,
      noLock,
      noHold,
    );
  });
  afterAll(async () => db?.cleanup());
  beforeEach(async () => {
    jest.clearAllMocks();
    await db.ds.query('TRUNCATE orders CASCADE');
    catalog.release.mockResolvedValue({});
    promotion.release.mockResolvedValue({});
  });
  afterEach(() => jest.restoreAllMocks());

  // Đơn (total 230000 theo seedOrder) + giao dịch PayOS
  async function seed(
    o: {
      orderStatus?: string;
      payStatus?: string;
      method?: string;
      code?: string | null;
      prev?: string[];
      gateway?: Record<string, unknown> | null;
    } = {},
  ) {
    const userId = randomUUID();
    const orderId = await seedOrder(db.ds, {
      user_id: userId,
      status: o.orderStatus ?? 'pending',
    });
    const [{ id }] = await db.ds.query<Array<{ id: string }>>(
      `INSERT INTO payments (order_id, method, transaction_id, previous_transaction_ids, amount, status, gateway_response)
       VALUES ($1, $2, $3, $4, 230000, $5, $6) RETURNING id`,
      [
        orderId,
        o.method ?? 'payos',
        o.code === undefined ? '111' : o.code,
        o.prev ?? [],
        o.payStatus ?? 'pending',
        o.gateway ? JSON.stringify(o.gateway) : null,
      ],
    );
    return { userId, orderId, paymentId: id };
  }
  const payment = (id: string) =>
    db.ds.getRepository(Payment).findOneByOrFail({ id });
  const orderStatus = async (id: string) =>
    (await db.ds.getRepository(Order).findOneByOrFail({ id })).status;
  const ledgerRows = () =>
    db.ds
      .getRepository(PaymentTransaction)
      .find({ order: { received_at: 'ASC' } });

  let refSeq = 0;
  // Dữ liệu webhook đúng kiểu WebhookData của SDK
  const webhook = (
    orderCode: number,
    extra: Partial<WebhookPayload> = {},
  ): WebhookPayload => ({
    orderCode,
    amount: 230000,
    description: 'CSVQR thanh toan',
    accountNumber: '12345678',
    reference: `FT${Date.now()}${++refSeq}`,
    transactionDateTime: '2026-11-21 10:15:00',
    currency: 'VND',
    paymentLinkId: 'pl',
    code: '00',
    desc: 'success',
    counterAccountBankId: '970422',
    counterAccountBankName: 'MB Bank',
    counterAccountName: 'NGUYEN VAN A',
    counterAccountNumber: '0123456789',
    virtualAccountName: null,
    virtualAccountNumber: null,
    ...extra,
  });

  // Luồng webhook như controller (§4.1): ghi sổ → tìm → markSuccess
  async function deliver(data: WebhookPayload, signature = 'sig') {
    const ledgerId = await ledger.record(data, signature);
    const found = await core.findForWebhook(data.orderCode);
    if (!found) {
      await ledger.settle(ledgerId, null, 'unmatched');
      return { ledgerId, found };
    }
    await core.markSuccess({
      found,
      orderCode: data.orderCode,
      paidAmount: data.amount,
      gatewayResponse: data,
      ledgerId,
    });
    return { ledgerId, found };
  }

  describe('markSuccess', () => {
    it('webhook hợp lệ: giao dịch success, đơn paid, sổ 1 dòng applied đủ dữ liệu; 7 truy vấn (chưa outbox)', async () => {
      const s = await seed();
      const q = countQueries();
      await deliver(webhook(111));
      const n = q.count;
      q.restore();

      expect(await payment(s.paymentId)).toMatchObject({
        status: 'success',
        needs_refund: false,
      });
      expect((await payment(s.paymentId)).paid_at).toBeInstanceOf(Date);
      expect(await orderStatus(s.orderId)).toBe('paid');
      const rows = await ledgerRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        outcome: 'applied',
        payment_id: s.paymentId,
        order_code: '111',
        amount: '230000',
        counter_account_name: 'NGUYEN VAN A',
        counter_account_number: '0123456789',
        counter_account_bank_name: 'MB Bank',
        transaction_date_time: '2026-11-21 10:15:00',
      });
      expect(rows[0].raw_payload).toMatchObject({ orderCode: 111 });
      expect(rows[0].processed_at).toBeInstanceOf(Date);
      // sổ 1 + tìm 1 + khoá đơn 1 + khoá giao dịch 1 + UPDATE payments 1 + UPDATE orders 1 + chốt sổ 1
      // T4.1: + outbox order.paid = 8
      expect(n).toBe(8);
    });

    it('trả qua link cũ (mã trong previous_transaction_ids) → ghi nhận đúng giao dịch', async () => {
      const s = await seed({ code: '222', prev: ['111'] });
      await deliver(webhook(111));
      expect((await payment(s.paymentId)).status).toBe('success');
      expect(await orderStatus(s.orderId)).toBe('paid');
    });

    it('webhook gửi trùng (cùng reference) → 1 dòng sổ, không đổi gì thêm', async () => {
      const s = await seed();
      const data = webhook(111);
      await deliver(data);
      const paidAt = (await payment(s.paymentId)).paid_at;
      await deliver(data);
      expect(await ledgerRows()).toHaveLength(1);
      expect((await ledgerRows())[0].outcome).toBe('applied');
      expect((await payment(s.paymentId)).paid_at).toEqual(paidAt);
    });

    it('webhook gửi trùng đồng thời → 1 dòng sổ, đơn paid một lần', async () => {
      const s = await seed();
      const data = webhook(111);
      await Promise.all([deliver(data), deliver(data), deliver(data)]);
      expect(await ledgerRows()).toHaveLength(1);
      expect((await ledgerRows())[0].outcome).toBe('applied');
      expect(await orderStatus(s.orderId)).toBe('paid');
    });

    it('khách trả cả link cũ và link mới → lần hai needs_refund, sổ applied + duplicate_payment (BR-10)', async () => {
      const s = await seed({ code: '222', prev: ['111'] });
      await deliver(webhook(222));
      await deliver(webhook(111));
      expect(await payment(s.paymentId)).toMatchObject({
        status: 'success',
        needs_refund: true,
      });
      expect(await orderStatus(s.orderId)).toBe('paid');
      expect((await ledgerRows()).map((r) => r.outcome)).toEqual([
        'applied',
        'duplicate_payment',
      ]);
    });

    it('poll áp tiền trước, webhook cùng mã tới sau → sổ applied (không thành duplicate_payment)', async () => {
      const s = await seed();
      await core.markSuccess({
        found: { id: s.paymentId, order_id: s.orderId },
        paidAmount: 230000,
        gatewayResponse: { orderCode: 111, status: 'PAID' },
      });
      await deliver(webhook(111));
      expect((await ledgerRows())[0].outcome).toBe('applied');
      expect((await payment(s.paymentId)).needs_refund).toBe(false);
    });

    it('sai số tiền → 400 NT-PAY-1005, giao dịch và đơn không đổi (BR-09)', async () => {
      const s = await seed();
      await expect(
        core.markSuccess({
          found: { id: s.paymentId, order_id: s.orderId },
          orderCode: 111,
          paidAmount: 1000,
        }),
      ).rejects.toMatchObject({ status: 400, code: 'NT-PAY-1005' });
      expect((await payment(s.paymentId)).status).toBe('pending');
      expect(await orderStatus(s.orderId)).toBe('pending');
    });

    it('giao dịch refunded → 400 NT-PAY-1009', async () => {
      const s = await seed({ payStatus: 'refunded' });
      await expect(
        core.markSuccess({
          found: { id: s.paymentId, order_id: s.orderId },
          orderCode: 111,
        }),
      ).rejects.toMatchObject({ code: 'NT-PAY-1009' });
    });

    it('đơn đã huỷ, giao dịch failed, khách trả link cũ → success + needs_refund, đơn giữ cancelled, sổ order_not_payable (BR-10)', async () => {
      const s = await seed({ orderStatus: 'cancelled', payStatus: 'failed' });
      await deliver(webhook(111));
      expect(await payment(s.paymentId)).toMatchObject({
        status: 'success',
        needs_refund: true,
      });
      expect(await orderStatus(s.orderId)).toBe('cancelled');
      expect((await ledgerRows())[0].outcome).toBe('order_not_payable');
    });

    it('đơn đã shipped → giao dịch success, đơn giữ shipped, không needs_refund', async () => {
      const s = await seed({ orderStatus: 'shipped' });
      await deliver(webhook(111));
      expect(await payment(s.paymentId)).toMatchObject({
        status: 'success',
        needs_refund: false,
      });
      expect(await orderStatus(s.orderId)).toBe('shipped');
    });

    it('ghi đơn lỗi giữa transaction → rollback: giao dịch vẫn pending, sổ còn received', async () => {
      const s = await seed();
      // Giữ hàm gốc để gọi lại với this của manager trong transaction
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const real = EntityManager.prototype.update;
      jest
        .spyOn(EntityManager.prototype, 'update')
        .mockImplementation(function (this: EntityManager, target, ...rest) {
          if (target === Order) return Promise.reject(new Error('db lỗi'));
          return real.call(this, target, ...rest);
        });
      await expect(deliver(webhook(111))).rejects.toThrow('db lỗi');
      jest.restoreAllMocks();
      expect((await payment(s.paymentId)).status).toBe('pending');
      expect(await orderStatus(s.orderId)).toBe('pending');
      expect((await ledgerRows())[0].outcome).toBe('received');
    });

    it('không thấy giao dịch theo orderCode → findForWebhook null, sổ unmatched, payment_id NULL', async () => {
      await deliver(webhook(999));
      const [row] = await ledgerRows();
      expect(row).toMatchObject({ outcome: 'unmatched', payment_id: null });
    });
  });

  describe('markFailed (B15)', () => {
    it('pending → failed, lưu gateway_response', async () => {
      const s = await seed();
      await core.markFailed({
        paymentId: s.paymentId,
        gatewayResponse: { status: 'CANCELLED' },
      });
      expect(await payment(s.paymentId)).toMatchObject({
        status: 'failed',
        gateway_response: { status: 'CANCELLED' },
      });
    });

    it('giao dịch success → trả nguyên, không ghi đè', async () => {
      const s = await seed({ payStatus: 'success' });
      const p = await core.markFailed({ transactionId: '111' });
      expect(p.status).toBe('success');
      expect((await payment(s.paymentId)).status).toBe('success');
    });

    it('không có giao dịch → 404 NT-PAY-1001', async () => {
      await expect(
        core.markFailed({ transactionId: '404' }),
      ).rejects.toMatchObject({
        code: 'NT-PAY-1001',
      });
    });

    it('markFailed (poll CANCELLED) chạy cùng markSuccess (webhook PAID) → cuối cùng success', async () => {
      for (let i = 0; i < 5; i++) {
        const s = await seed({ code: String(500 + i) });
        await Promise.all([
          core.markFailed({ transactionId: String(500 + i) }),
          deliver(webhook(500 + i)),
        ]);
        expect((await payment(s.paymentId)).status).toBe('success');
      }
    });
  });

  describe('huỷ đơn và webhook cùng lúc (BR-10)', () => {
    it('không deadlock; kết quả đúng một trong hai nhánh', async () => {
      for (let i = 0; i < 5; i++) {
        const s = await seed({ code: String(700 + i) });
        const [c, w] = await Promise.allSettled([
          cancel.cancelByUser(s.userId, s.orderId),
          deliver(webhook(700 + i)),
        ]);
        expect(w.status).toBe('fulfilled');
        const p = await payment(s.paymentId);
        const o = await orderStatus(s.orderId);
        if (c.status === 'fulfilled') {
          // Huỷ thắng: giao dịch failed rồi tiền về → success + needs_refund, đơn cancelled
          expect([o, p.status, p.needs_refund]).toEqual([
            'cancelled',
            'success',
            true,
          ]);
        } else {
          // Thanh toán thắng: huỷ thấy paid → 400
          expect(c.reason).toMatchObject({ code: 'NT-ORD-1008' });
          expect([o, p.status, p.needs_refund]).toEqual([
            'paid',
            'success',
            false,
          ]);
        }
      }
    });

    it('huỷ đơn có giao dịch pending → giao dịch failed; giao dịch success không đổi', async () => {
      const a = await seed();
      await cancel.cancelByUser(a.userId, a.orderId);
      expect((await payment(a.paymentId)).status).toBe('failed');

      const b = await seed({
        orderStatus: 'paid',
        payStatus: 'success',
        code: '333',
      });
      await db.ds.transaction((m) => core.voidPendingByOrder(m, b.orderId));
      expect((await payment(b.paymentId)).status).toBe('success');
    });
  });

  describe('khoá đơn (T3.9, BR-20)', () => {
    const lockOf = (busy = false) => ({
      withOrderLock: jest.fn((_id: string, fn: () => Promise<unknown>) =>
        busy ? Promise.reject(new OrderLockBusyError(_id)) : fn(),
      ),
    });

    it('markSuccess, confirmCod khoá theo order_id; markSuccess truyền waitMs của bên gọi', async () => {
      const lock = lockOf();
      const c = new PaymentCoreService(
        db.ds,
        ledger,
        lock as unknown as OrderLockService,
        noHold,
      );
      const cod = await seed({ method: 'cod', code: null });
      await c.confirmCod(cod.paymentId);
      expect(lock.withOrderLock).toHaveBeenLastCalledWith(
        cod.orderId,
        expect.any(Function),
      );
      const p = await seed({ code: '222' });
      await c.markSuccess(
        { paymentId: p.paymentId, paidAmount: 230000 },
        { waitMs: 0 },
      );
      expect(lock.withOrderLock).toHaveBeenLastCalledWith(
        p.orderId,
        expect.any(Function),
        { waitMs: 0 },
      );
      expect(await orderStatus(p.orderId)).toBe('paid');
    });

    it('khoá bận → OrderLockBusyError nguyên cho bên gọi đổi; giao dịch, đơn không đổi', async () => {
      const c = new PaymentCoreService(
        db.ds,
        ledger,
        lockOf(true) as unknown as OrderLockService,
        noHold,
      );
      const p = await seed({ code: '333' });
      await expect(
        c.markSuccess({ paymentId: p.paymentId, paidAmount: 230000 }),
      ).rejects.toBeInstanceOf(OrderLockBusyError);
      const cod = await seed({ method: 'cod', code: null });
      await expect(c.confirmCod(cod.paymentId)).rejects.toBeInstanceOf(
        OrderLockBusyError,
      );
      expect((await payment(p.paymentId)).status).toBe('pending');
      expect((await payment(cod.paymentId)).status).toBe('pending');
      expect(await orderStatus(p.orderId)).toBe('pending');
    });
  });

  describe('gỡ hẹn hạn giữ hàng (T3.10, BR-19)', () => {
    it('markSuccess, confirmCod thành công → unschedule(order_id) sau commit; khoá bận → không gỡ', async () => {
      const unschedule = jest.spyOn(noHold, 'unschedule');
      const p = await seed({ code: '444' });
      await core.markSuccess({ paymentId: p.paymentId, paidAmount: 230000 });
      expect(unschedule).toHaveBeenLastCalledWith(p.orderId);
      const cod = await seed({ method: 'cod', code: null });
      await core.confirmCod(cod.paymentId);
      expect(unschedule).toHaveBeenLastCalledWith(cod.orderId);
      unschedule.mockClear();
      const busy = new PaymentCoreService(
        db.ds,
        ledger,
        {
          withOrderLock: (id: string) =>
            Promise.reject(new OrderLockBusyError(id)),
        } as unknown as OrderLockService,
        noHold,
      );
      const q = await seed({ code: '555' });
      await busy.markSuccess({ paymentId: q.paymentId }).catch(() => undefined);
      expect(unschedule).not.toHaveBeenCalled();
      unschedule.mockRestore();
    });
  });

  describe('COD', () => {
    it('confirmCod: giao dịch success, đơn paid; trả { id, status, paid_at }', async () => {
      const s = await seed({ method: 'cod', code: null });
      const r = await core.confirmCod(s.paymentId);
      expect(r).toMatchObject({ id: s.paymentId, status: 'success' });
      expect(r.paid_at).toBeInstanceOf(Date);
      expect(await orderStatus(s.orderId)).toBe('paid');
    });

    it('confirmCod: giao dịch PayOS → 400 NT-PAY-1008; COD đã success → 400 NT-PAY-1009; không có → 404', async () => {
      const a = await seed();
      await expect(core.confirmCod(a.paymentId)).rejects.toMatchObject({
        code: 'NT-PAY-1008',
      });
      const b = await seed({ method: 'cod', code: null, payStatus: 'success' });
      await expect(core.confirmCod(b.paymentId)).rejects.toMatchObject({
        code: 'NT-PAY-1009',
        message:
          'Giao dịch đang ở trạng thái "success", không thể xác nhận thu tiền',
      });
      await expect(core.confirmCod(randomUUID())).rejects.toMatchObject({
        code: 'NT-PAY-1001',
      });
    });

    it('confirmCodByOrder: COD pending → success (true); trường hợp khác không làm gì (false)', async () => {
      const a = await seed({ method: 'cod', code: null });
      expect(
        await db.ds.transaction((m) => core.confirmCodByOrder(m, a.orderId)),
      ).toBe(true);
      expect((await payment(a.paymentId)).status).toBe('success');
      const b = await seed();
      expect(
        await db.ds.transaction((m) => core.confirmCodByOrder(m, b.orderId)),
      ).toBe(false);
      expect((await payment(b.paymentId)).status).toBe('pending');
    });
  });

  it('sumRevenue: tổng giao dịch success, lọc theo paid_at', async () => {
    const a = await seed({ payStatus: 'success', code: '1' });
    await seed({ payStatus: 'pending', code: '2' });
    await db.ds.query(
      `UPDATE payments SET paid_at = '2026-11-10' WHERE id = $1`,
      [a.paymentId],
    );
    expect(await core.sumRevenue()).toBe(230000);
    expect(await core.sumRevenue(new Date('2026-11-11'))).toBe(0);
  });

  describe('sổ tiền về', () => {
    it('thiếu reference → chống trùng theo sig:<signature>; gửi lại cùng payload vẫn 1 dòng', async () => {
      await seed();
      const data = webhook(111, { reference: undefined as unknown as string });
      await deliver(data, 'abc');
      await deliver(data, 'abc');
      const rows = await db.ds.query<Array<{ dedup_key: string }>>(
        'SELECT dedup_key FROM payment_transactions',
      );
      expect(rows).toEqual([{ dedup_key: 'sig:abc' }]);
    });

    it('sai số tiền: settle amount_mismatch giữ đúng payment_id; settle lại giá trị khác không đổi', async () => {
      const s = await seed();
      const id = await ledger.record(webhook(111, { amount: 1 }), 's');
      await ledger.settle(id, s.paymentId, 'amount_mismatch');
      await ledger.settle(id, s.paymentId, 'applied');
      const [row] = await ledgerRows();
      expect(row).toMatchObject({
        outcome: 'amount_mismatch',
        payment_id: s.paymentId,
      });
    });

    it('listForPayment: theo received_at, không raw_payload, dedup_key; amount là chuỗi', async () => {
      const s = await seed({ code: '222', prev: ['111'] });
      await deliver(webhook(222));
      await deliver(webhook(111));
      const list = await ledger.listForPayment(s.paymentId);
      expect(list.map((r) => r.outcome)).toEqual([
        'applied',
        'duplicate_payment',
      ]);
      expect(list[0]).not.toHaveProperty('raw_payload');
      expect(list[0]).not.toHaveProperty('dedup_key');
      expect(list[0]).toMatchObject({
        amount: '230000',
        counter_account_name: 'NGUYEN VAN A',
      });
    });
  });
});
