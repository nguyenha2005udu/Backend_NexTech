import type { ConfigService } from '@nestjs/config';
import type { PayOS } from '@payos/node';
import { randomUUID } from 'node:crypto';
import { Order } from '../../database/entities/order.entity';
import { Payment } from '../../database/entities/payment.entity';
import {
  countQueries,
  createTestDb,
  noLock,
  seedOrder,
  TestDb,
} from '../../test-helpers';
import { OrderLockBusyError } from '../../database/db-lock-error';
import { PaymentCoreService } from './payment-core.service';
import { PaymentLedgerService } from './payment-ledger.service';
import { PaymentService } from './payment.service';

// POSTGRES THẬT, PayOS giả. Chạy: docker compose up -d postgres && npm run test:int -w services/order -- payment.service
// NT.PAYMENT API_Spec §1 (POST /api/payments, GET /api/payments/:id/status), Component_Class_Design §6 (BR-08,
// BR-19 phần không cần Redis), NT.ORDER_HOLD API_Spec §2 (UPDATE orders có điều kiện, không khoá Redis).

jest.setTimeout(60_000);

const PAYOS_CFG = {
  clientId: 'dev',
  apiKey: 'dev',
  checksumKey: 'dev-checksum',
  returnUrl: 'http://r',
  cancelUrl: 'http://c',
  timeoutMs: 5000,
};

describe('PaymentService (Postgres thật)', () => {
  let db: TestDb;
  let service: PaymentService;
  const payos = {
    paymentRequests: { create: jest.fn(), get: jest.fn() },
  };

  beforeAll(async () => {
    db = await createTestDb();
    const core = new PaymentCoreService(
      db.ds,
      new PaymentLedgerService(db.ds),
      noLock,
    );
    service = new PaymentService(
      db.ds.getRepository(Order),
      db.ds.getRepository(Payment),
      db.ds,
      payos as unknown as PayOS,
      core,
      { getOrThrow: () => PAYOS_CFG } as unknown as ConfigService,
    );
  });
  afterAll(async () => db?.cleanup());
  beforeEach(async () => {
    jest.clearAllMocks();
    await db.ds.query('TRUNCATE orders CASCADE');
    payos.paymentRequests.create.mockImplementation(
      (b: { orderCode: number }) =>
        Promise.resolve({
          orderCode: b.orderCode,
          checkoutUrl: `http://pay/${b.orderCode}`,
          qrCode: `QR${b.orderCode}`,
          status: 'PENDING',
        }),
    );
  });
  afterEach(() => jest.restoreAllMocks());

  async function pendingOrder(userId = randomUUID(), expiresAt?: Date | null) {
    const id = await seedOrder(db.ds, {
      user_id: userId,
      status: 'pending',
      payment_expires_at: expiresAt ?? null,
    });
    return { userId, orderId: id };
  }
  const paymentOf = (orderId: string) =>
    db.ds.getRepository(Payment).findOneBy({ order_id: orderId });
  const orderOf = (id: string) =>
    db.ds.getRepository(Order).findOneByOrFail({ id });

  describe('create', () => {
    it('COD: giao dịch pending, dừng hạn (payment_expires_at NULL), expires_at null; 4 truy vấn', async () => {
      const o = await pendingOrder(undefined, new Date(Date.now() + 600_000));
      const q = countQueries();
      const r = await service.create(o.userId, {
        order_id: o.orderId,
        method: 'cod',
      });
      const n = q.count;
      q.restore();

      expect(r).toEqual({
        id: expect.any(String) as unknown,
        order_id: o.orderId,
        method: 'cod',
        amount: '230000',
        currency: 'VND',
        status: 'pending',
        payment_url: null,
        qr_code: null,
        expires_at: null,
      });
      expect(payos.paymentRequests.create).not.toHaveBeenCalled();
      expect((await orderOf(o.orderId)).payment_expires_at).toBeNull();
      expect(await paymentOf(o.orderId)).toMatchObject({
        method: 'cod',
        status: 'pending',
        transaction_id: null,
      });
      expect(n).toBe(4);
    });

    it('PayOS: lưu orderCode TRƯỚC khi gọi PayOS, expiredAt = hạn giữ hàng, lưu link; 5 truy vấn', async () => {
      const expires = new Date(Date.now() + 600_000);
      const o = await pendingOrder(undefined, expires);
      let codeInDbDuringCall: string | null | undefined;
      payos.paymentRequests.create.mockImplementation(
        async (b: { orderCode: number }) => {
          codeInDbDuringCall = (await paymentOf(o.orderId))?.transaction_id;
          return {
            orderCode: b.orderCode,
            checkoutUrl: 'http://pay/x',
            qrCode: 'QRX',
          };
        },
      );

      const q = countQueries();
      const r = await service.create(o.userId, {
        order_id: o.orderId,
        method: 'payos',
      });
      const n = q.count - 1; // trừ câu đọc trong mock PayOS
      q.restore();

      const [body] = payos.paymentRequests.create.mock.calls[0] as [
        Record<string, unknown>,
      ];
      expect(body).toMatchObject({
        amount: 230000,
        returnUrl: 'http://r',
        cancelUrl: 'http://c',
        expiredAt: Math.floor(expires.getTime() / 1000),
      });
      expect(String(body.description).length).toBeLessThanOrEqual(25);
      expect(codeInDbDuringCall).toBe(String(body.orderCode));
      expect(r).toMatchObject({
        method: 'payos',
        status: 'pending',
        payment_url: 'http://pay/x',
        qr_code: 'QRX',
        expires_at: expires,
      });
      const p = await paymentOf(o.orderId);
      expect(p?.gateway_response).toMatchObject({
        checkoutUrl: 'http://pay/x',
      });
      expect((await orderOf(o.orderId)).payment_expires_at).toEqual(expires); // PayOS không dừng hạn
      expect(n).toBe(5);
    });

    it('PayOS khi đơn chưa có hạn (trước T3.10) → không gửi expiredAt, expires_at null', async () => {
      const o = await pendingOrder();
      const r = await service.create(o.userId, {
        order_id: o.orderId,
        method: 'payos',
      });
      const [body] = payos.paymentRequests.create.mock.calls[0] as [
        Record<string, unknown>,
      ];
      expect(body).not.toHaveProperty('expiredAt');
      expect(r.expires_at).toBeNull();
    });

    it('đơn không có / của người khác → 404 NT-PAY-1001 "Không tìm thấy đơn hàng"', async () => {
      const o = await pendingOrder();
      await expect(
        service.create(randomUUID(), { order_id: o.orderId, method: 'cod' }),
      ).rejects.toMatchObject({
        status: 404,
        code: 'NT-PAY-1001',
        message: 'Không tìm thấy đơn hàng',
      });
    });

    it('đơn không pending → 400 NT-PAY-1002 câu be/ (BR-08)', async () => {
      const u = randomUUID();
      const id = await seedOrder(db.ds, { user_id: u, status: 'paid' });
      await expect(
        service.create(u, { order_id: id, method: 'cod' }),
      ).rejects.toMatchObject({
        status: 400,
        code: 'NT-PAY-1002',
        message:
          'Đơn hàng đang ở trạng thái "paid", không thể tạo giao dịch thanh toán mới',
      });
    });

    it('đã có giao dịch không phải failed → 409 NT-PAY-1003 (BR-08)', async () => {
      const o = await pendingOrder();
      await service.create(o.userId, { order_id: o.orderId, method: 'cod' });
      await expect(
        service.create(o.userId, { order_id: o.orderId, method: 'payos' }),
      ).rejects.toMatchObject({ status: 409, code: 'NT-PAY-1003' });
    });

    it('hai lần tạo đồng thời → một thành công, một 409, một giao dịch', async () => {
      const o = await pendingOrder();
      const rs = await Promise.allSettled([
        service.create(o.userId, { order_id: o.orderId, method: 'cod' }),
        service.create(o.userId, { order_id: o.orderId, method: 'cod' }),
      ]);
      expect(rs.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
      expect(rs.find((x) => x.status === 'rejected')).toMatchObject({
        reason: { code: 'NT-PAY-1003' },
      });
      expect(
        await db.ds.getRepository(Payment).countBy({ order_id: o.orderId }),
      ).toBe(1);
    });

    it('đã quá payment_expires_at → 400 NT-PAY-1010, không có giao dịch (BR-19)', async () => {
      const o = await pendingOrder(undefined, new Date(Date.now() - 1000));
      await expect(
        service.create(o.userId, { order_id: o.orderId, method: 'cod' }),
      ).rejects.toMatchObject({ status: 400, code: 'NT-PAY-1010' });
      expect(await paymentOf(o.orderId)).toBeNull();
    });

    it('PayOS lỗi → 503 NT-PAY-1006, giao dịch failed, transaction_id vẫn còn, không lộ lỗi PayOS', async () => {
      const o = await pendingOrder();
      payos.paymentRequests.create.mockRejectedValue(
        new Error('secret upstream detail'),
      );
      const err = await service
        .create(o.userId, { order_id: o.orderId, method: 'payos' })
        .catch((e: unknown) => e);
      expect(err).toMatchObject({ status: 503, code: 'NT-PAY-1006' });
      expect((err as Error).message).not.toContain('secret');
      const p = await paymentOf(o.orderId);
      expect(p?.status).toBe('failed');
      expect(p?.transaction_id).toMatch(/^\d+$/);
    });

    it('giao dịch failed, thử lại phương thức khác → dùng lại dòng cũ, mã cũ vào previous_transaction_ids (BR-08)', async () => {
      const o = await pendingOrder();
      payos.paymentRequests.create.mockRejectedValueOnce(new Error('x'));
      await service
        .create(o.userId, { order_id: o.orderId, method: 'payos' })
        .catch(() => null);
      const failed = await paymentOf(o.orderId);

      const r = await service.create(o.userId, {
        order_id: o.orderId,
        method: 'cod',
      });

      expect(r.id).toBe(failed?.id);
      expect(await paymentOf(o.orderId)).toMatchObject({
        method: 'cod',
        status: 'pending',
        transaction_id: null,
        previous_transaction_ids: [failed?.transaction_id],
        gateway_response: null,
      });
    });

    it('thử lại PayOS sau lỗi → mã mới, mã cũ vẫn tra được', async () => {
      const o = await pendingOrder();
      payos.paymentRequests.create.mockRejectedValueOnce(new Error('x'));
      await service
        .create(o.userId, { order_id: o.orderId, method: 'payos' })
        .catch(() => null);
      const oldCode = (await paymentOf(o.orderId))?.transaction_id;
      await service.create(o.userId, { order_id: o.orderId, method: 'payos' });
      const p = await paymentOf(o.orderId);
      expect(p?.transaction_id).not.toBe(oldCode);
      expect(p?.previous_transaction_ids).toEqual([oldCode]);
    });
  });

  describe('getStatus', () => {
    async function payosPayment() {
      const o = await pendingOrder();
      const r = await service.create(o.userId, {
        order_id: o.orderId,
        method: 'payos',
      });
      jest.clearAllMocks();
      return { ...o, paymentId: r.id };
    }

    it('không có → 404 NT-PAY-1001; của người khác → 403 NT-PAY-1007', async () => {
      await expect(
        service.getStatus(randomUUID(), randomUUID()),
      ).rejects.toMatchObject({
        status: 404,
        code: 'NT-PAY-1001',
        message: 'Không tìm thấy giao dịch thanh toán',
      });
      const s = await payosPayment();
      await expect(
        service.getStatus(randomUUID(), s.paymentId),
      ).rejects.toMatchObject({
        status: 403,
        code: 'NT-PAY-1007',
      });
    });

    it('PayOS báo PAID → markSuccess: giao dịch success, đơn paid; trả { id, status, paid_at, transaction_id }', async () => {
      const s = await payosPayment();
      payos.paymentRequests.get.mockResolvedValue({
        status: 'PAID',
        amountPaid: 230000,
        orderCode: 1,
      });
      const r = await service.getStatus(s.userId, s.paymentId);
      expect(r).toMatchObject({ id: s.paymentId, status: 'success' });
      expect(r.paid_at).toBeInstanceOf(Date);
      expect((await orderOf(s.orderId)).status).toBe('paid');
    });

    it('PAID nhưng khoá đơn bận → không chờ (waitMs 0), trả trạng thái đang lưu (NT.PAYMENT Processing_Flow, BR-20)', async () => {
      const s = await payosPayment();
      payos.paymentRequests.get.mockResolvedValue({
        status: 'PAID',
        amountPaid: 230000,
        orderCode: 1,
      });
      const spy = jest
        .spyOn(PaymentCoreService.prototype, 'markSuccess')
        .mockRejectedValue(new OrderLockBusyError(s.orderId));
      const r = await service.getStatus(s.userId, s.paymentId);
      expect(spy).toHaveBeenCalledWith(expect.anything(), { waitMs: 0 });
      spy.mockRestore();
      expect(r.status).toBe('pending');
      expect((await orderOf(s.orderId)).status).toBe('pending');
    });

    it('PayOS báo CANCELLED → failed', async () => {
      const s = await payosPayment();
      payos.paymentRequests.get.mockResolvedValue({ status: 'CANCELLED' });
      expect((await service.getStatus(s.userId, s.paymentId)).status).toBe(
        'failed',
      );
    });

    it('PayOS lỗi → giữ pending, lần sau hỏi lại', async () => {
      const s = await payosPayment();
      payos.paymentRequests.get.mockRejectedValue(new Error('timeout'));
      expect((await service.getStatus(s.userId, s.paymentId)).status).toBe(
        'pending',
      );
    });

    it('COD hoặc đã success → không hỏi PayOS; 1 truy vấn', async () => {
      const o = await pendingOrder();
      const c = await service.create(o.userId, {
        order_id: o.orderId,
        method: 'cod',
      });
      const q = countQueries();
      const r = await service.getStatus(o.userId, c.id);
      const n = q.count;
      q.restore();
      expect(r.status).toBe('pending');
      expect(payos.paymentRequests.get).not.toHaveBeenCalled();
      expect(n).toBe(1);
    });

    it('PAID qua poll: 5 truy vấn (đọc + khoá đơn + khoá giao dịch + 2 UPDATE)', async () => {
      const s = await payosPayment();
      payos.paymentRequests.get.mockResolvedValue({
        status: 'PAID',
        amountPaid: 230000,
      });
      const q = countQueries();
      await service.getStatus(s.userId, s.paymentId);
      const n = q.count;
      q.restore();
      expect(n).toBe(5);
    });
  });
});
