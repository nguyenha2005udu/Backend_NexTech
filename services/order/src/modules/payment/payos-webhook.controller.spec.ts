import { Logger } from '@nestjs/common';
import { BusinessException } from '@nextech/service-kit';
import { PayOS, WebhookError, type Webhook } from '@payos/node';
import { createHmac } from 'node:crypto';
import { OrderLockBusyError } from '../../database/db-lock-error';
import type { PaymentCoreService } from './payment-core.service';
import type {
  PaymentLedgerService,
  WebhookPayload,
} from './payment-ledger.service';
import { PayosWebhookController } from './payos-webhook.controller';

// NT.PAYMENT API_Spec §1 (bảng webhook), Component_Class_Design §2 (chỉ nuốt 1001, 1005, 1009), §4.1, §5 (thuật
// toán ký của mock khớp payos.webhooks.verify).

const data = (o: Partial<WebhookPayload> = {}): WebhookPayload => ({
  orderCode: 111,
  amount: 230000,
  description: 'CSVQR',
  accountNumber: '123',
  reference: 'FT1',
  transactionDateTime: '2026-11-21 10:00:00',
  currency: 'VND',
  paymentLinkId: 'pl',
  code: '00',
  desc: 'success',
  counterAccountBankId: null,
  counterAccountBankName: 'MB Bank',
  counterAccountName: 'NGUYEN VAN A',
  counterAccountNumber: '0123456789',
  virtualAccountName: null,
  virtualAccountNumber: null,
  ...o,
});
const body = (d: WebhookPayload): Webhook => ({
  code: '00',
  desc: 'success',
  success: true,
  data: d,
  signature: 'sig',
});

describe('PayosWebhookController', () => {
  const payos = { webhooks: { verify: jest.fn() } };
  const core = {
    findForWebhook: jest.fn(),
    markSuccess: jest.fn(),
    markFailed: jest.fn(),
  };
  const ledger = { record: jest.fn(), settle: jest.fn() };
  const ctrl = new PayosWebhookController(
    payos as unknown as PayOS,
    core as unknown as PaymentCoreService,
    ledger as unknown as PaymentLedgerService,
  );
  const FOUND = { id: 'p1', order_id: 'o1' };
  let logs: string[];

  beforeEach(() => {
    jest.clearAllMocks();
    logs = [];
    for (const level of ['log', 'warn', 'error'] as const) {
      jest
        .spyOn(Logger.prototype, level)
        .mockImplementation(
          (...args: unknown[]) => void logs.push(String(args[0])),
        );
    }
    payos.webhooks.verify.mockImplementation((b: Webhook) =>
      Promise.resolve(b.data),
    );
    ledger.record.mockResolvedValue('L1');
    core.findForWebhook.mockResolvedValue(FOUND);
    core.markSuccess.mockResolvedValue({});
    core.markFailed.mockResolvedValue({});
  });
  afterEach(() => jest.restoreAllMocks());

  it('sai chữ ký → 400 NT-PAY-1004, không ghi gì', async () => {
    payos.webhooks.verify.mockRejectedValue(
      new WebhookError('Invalid signature'),
    );
    await expect(ctrl.handle(body(data()))).rejects.toMatchObject({
      status: 400,
      code: 'NT-PAY-1004',
      message: 'Webhook không hợp lệ',
    });
    expect(ledger.record).not.toHaveBeenCalled();
  });

  it('verify lỗi khác (không phải WebhookError) → ném lại', async () => {
    payos.webhooks.verify.mockRejectedValue(new Error('x'));
    await expect(ctrl.handle(body(data()))).rejects.toThrow('x');
  });

  it('tiền về hợp lệ: ghi sổ (kèm signature) → tìm giao dịch → markSuccess đủ tham số; 200', async () => {
    const d = data();
    await expect(ctrl.handle(body(d))).resolves.toEqual({ success: true });
    expect(ledger.record).toHaveBeenCalledWith(d, 'sig');
    expect(core.findForWebhook).toHaveBeenCalledWith(111);
    expect(core.markSuccess).toHaveBeenCalledWith({
      found: FOUND,
      orderCode: 111,
      paidAmount: 230000,
      gatewayResponse: d,
      ledgerId: 'L1',
    });
  });

  it('không thấy giao dịch → sổ unmatched, log error kèm orderCode, amount; 200', async () => {
    core.findForWebhook.mockResolvedValue(null);
    await expect(ctrl.handle(body(data()))).resolves.toEqual({ success: true });
    expect(ledger.settle).toHaveBeenCalledWith('L1', null, 'unmatched');
    expect(core.markSuccess).not.toHaveBeenCalled();
    expect(logs.join('\n')).toMatch(/orderCode=111.*amount=230000/);
  });

  it.each([
    ['NT-PAY-1005', 'amount_mismatch'],
    ['NT-PAY-1009', 'invalid_payment_state'],
  ])(
    'markSuccess ném %s → sổ %s với payment_id, nuốt lỗi, 200',
    async (code, outcome) => {
      core.markSuccess.mockRejectedValue(new BusinessException(400, code, 'x'));
      await expect(ctrl.handle(body(data()))).resolves.toEqual({
        success: true,
      });
      expect(ledger.settle).toHaveBeenCalledWith('L1', 'p1', outcome);
    },
  );

  it('markSuccess ném 1001 (giao dịch biến mất giữa chừng) → nuốt, 200', async () => {
    core.markSuccess.mockRejectedValue(
      new BusinessException(404, 'NT-PAY-1001', 'x'),
    );
    await expect(ctrl.handle(body(data()))).resolves.toEqual({ success: true });
  });

  it('lỗi khác (DB) → ném (500), sổ giữ received để PayOS gửi lại', async () => {
    core.markSuccess.mockRejectedValue(new Error('db lỗi'));
    await expect(ctrl.handle(body(data()))).rejects.toThrow('db lỗi');
    expect(ledger.settle).not.toHaveBeenCalled();
  });

  it('khoá đơn bận (Redis hoặc 55P03) → 503 NT-GEN-0503 để PayOS gửi lại; sổ giữ received (NT.PAYMENT §2, BR-20)', async () => {
    core.markSuccess.mockRejectedValue(new OrderLockBusyError('o1', 'db'));
    const err = (await ctrl
      .handle(body(data()))
      .catch((e: unknown) => e)) as BusinessException;
    expect(err).toBeInstanceOf(BusinessException);
    expect(err.getStatus()).toBe(503);
    expect(err.code).toBe('NT-GEN-0503');
    expect(ledger.settle).not.toHaveBeenCalled();
  });

  it('lỗi nghiệp vụ khác 1001/1005/1009 → không nuốt', async () => {
    core.markSuccess.mockRejectedValue(
      new BusinessException(400, 'NT-PAY-1002', 'x'),
    );
    await expect(ctrl.handle(body(data()))).rejects.toMatchObject({
      code: 'NT-PAY-1002',
    });
  });

  it('data.code ≠ 00 → markFailed theo orderCode, không ghi sổ; 200', async () => {
    const d = data({ code: '01', desc: 'cancelled' });
    await expect(ctrl.handle(body(d))).resolves.toEqual({ success: true });
    expect(core.markFailed).toHaveBeenCalledWith({
      transactionId: '111',
      gatewayResponse: d,
    });
    expect(ledger.record).not.toHaveBeenCalled();
  });

  it('data.code ≠ 00, giao dịch không có (1001) → nuốt, 200; lỗi DB → ném', async () => {
    core.markFailed.mockRejectedValueOnce(
      new BusinessException(404, 'NT-PAY-1001', 'x'),
    );
    await expect(ctrl.handle(body(data({ code: '01' })))).resolves.toEqual({
      success: true,
    });
    core.markFailed.mockRejectedValueOnce(new Error('db'));
    await expect(ctrl.handle(body(data({ code: '01' })))).rejects.toThrow('db');
  });

  it('không log dữ liệu người chuyển (security-policy §5)', async () => {
    core.findForWebhook.mockResolvedValueOnce(null);
    await ctrl.handle(body(data()));
    core.markSuccess.mockRejectedValueOnce(
      new BusinessException(400, 'NT-PAY-1005', 'x'),
    );
    await ctrl.handle(body(data()));
    const all = logs.join('\n');
    expect(all).not.toContain('NGUYEN VAN A');
    expect(all).not.toContain('0123456789');
  });
});

// Thuật toán ký của infra/payos-mock (Component_Class_Design §5): khoá sắp xếp, null → rỗng, HMAC-SHA256 hex
function mockSign(d: Record<string, unknown>, key: string): string {
  const q = Object.keys(d)
    .sort()
    .map(
      (k) =>
        `${k}=${d[k] === null || d[k] === undefined ? '' : String(d[k] as string)}`,
    )
    .join('&');
  return createHmac('sha256', key).update(q).digest('hex');
}

describe('chữ ký của PayOS mock qua SDK thật', () => {
  const sdk = new PayOS({
    clientId: 'dev',
    apiKey: 'dev',
    checksumKey: 'dev-checksum',
  });

  it('payos.webhooks.verify chấp nhận payload mock ký bằng PAYOS_CHECKSUM_KEY', async () => {
    const d = data();
    const signed = { ...body(d), signature: mockSign(d, 'dev-checksum') };
    await expect(sdk.webhooks.verify(signed)).resolves.toMatchObject({
      orderCode: 111,
    });
  });

  it('ký bằng khoá khác → WebhookError', async () => {
    const d = data();
    const signed = { ...body(d), signature: mockSign(d, 'khac') };
    await expect(sdk.webhooks.verify(signed)).rejects.toBeInstanceOf(
      WebhookError,
    );
  });
});
