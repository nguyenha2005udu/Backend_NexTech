import {
  BusinessException,
  UpstreamBusinessError,
  UpstreamError,
} from '@nextech/service-kit';
import type { Order } from '../../database/entities/order.entity';
import { failureFieldsOf, isBudgetExhausted, toOutcome } from './saga.types';

// NT.CHECKOUT_SAGA Component_Class_Design §3 (SagaOutcome), §4 (ngân sách), API_Spec §5
describe('isBudgetExhausted', () => {
  const now = 1_000_000;

  it('không có deadline (cron) → không bao giờ hết', () => {
    expect(isBudgetExhausted(undefined, now)).toBe(false);
  });

  it('còn từ 1 giây trở lên → chưa hết', () => {
    expect(isBudgetExhausted(now + 1000, now)).toBe(false);
  });

  it('còn dưới 1 giây → hết (dừng gọi, trả 202)', () => {
    expect(isBudgetExhausted(now + 999, now)).toBe(true);
    expect(isBudgetExhausted(now - 1, now)).toBe(true);
  });
});

describe('toOutcome', () => {
  const order = (o: Partial<Order>) => ({ id: 'o1', ...o }) as Order;

  it('processing (kể cả compensating) → in_doubt', () => {
    expect(toOutcome(order({ status: 'processing' })).kind).toBe('in_doubt');
  });

  it('pending trở đi → confirmed', () => {
    for (const status of ['pending', 'paid', 'shipped', 'cancelled'] as const) {
      expect(toOutcome(order({ status })).kind).toBe('confirmed');
    }
  });

  it('failed → failed, lỗi dựng lại từ failure_status/code/message đã lưu', () => {
    const out = toOutcome(
      order({
        status: 'failed',
        failure_status: 409,
        failure_code: 'NT-CAT-1001',
        failure_message: 'Sản phẩm "X" không đủ hàng trong kho',
      }),
    );
    expect(out.kind).toBe('failed');
    if (out.kind !== 'failed') throw new Error('không failed');
    const err = out.error as BusinessException;
    expect(err).toBeInstanceOf(BusinessException);
    expect(err.getStatus()).toBe(409);
    expect(err.code).toBe('NT-CAT-1001');
    expect(err.message).toBe('Sản phẩm "X" không đủ hàng trong kho');
  });
});

// NT.CHECKOUT_SAGA Component_Class_Design §6 (v1.6): lưu lỗi gốc để GET /api/orders/:id trả `failure`
// và gửi lại cùng Idempotency-Key trả đúng lỗi cũ. Mã lưu trùng mã client nhận (AllExceptionsFilter).
describe('failureFieldsOf', () => {
  it('lỗi nghiệp vụ của service đích → mã, câu, status gốc', () => {
    expect(
      failureFieldsOf(
        new UpstreamBusinessError(
          'catalog',
          409,
          'NT-CAT-1001',
          'Sản phẩm "X" không đủ hàng trong kho',
        ),
      ),
    ).toEqual({
      failure_code: 'NT-CAT-1001',
      failure_message: 'Sản phẩm "X" không đủ hàng trong kho',
      failure_status: 409,
    });
  });

  it('đích trả 4xx không có code → mã theo status như filter (codeForStatus)', () => {
    expect(
      failureFieldsOf(
        new UpstreamBusinessError('promotion', 409, undefined, 'x'),
      ),
    ).toMatchObject({ failure_code: 'NT-GEN-0005', failure_status: 409 });
  });

  it('message dạng mảng (lỗi validate) → nối bằng "; "', () => {
    expect(
      failureFieldsOf(
        new UpstreamBusinessError('promotion', 400, 'NT-GEN-0001', [
          'a sai',
          'b sai',
        ]),
      ).failure_message,
    ).toBe('a sai; b sai');
  });

  it('lỗi hạ tầng → NT-GEN-0503, câu không lộ địa chỉ nội bộ', () => {
    expect(
      failureFieldsOf(
        new UpstreamError('catalog', 'ECONNREFUSED', 'not_executed'),
      ),
    ).toEqual({
      failure_code: 'NT-GEN-0503',
      failure_message: 'Service catalog không sẵn sàng',
      failure_status: 503,
    });
  });

  it('BusinessException → mã của nó', () => {
    expect(
      failureFieldsOf(new BusinessException(400, 'NT-ORD-1004', 'y')),
    ).toEqual({
      failure_code: 'NT-ORD-1004',
      failure_message: 'y',
      failure_status: 400,
    });
  });

  it('mã dài quá cột varchar(30) → cắt', () => {
    const code = failureFieldsOf(
      new UpstreamBusinessError('x', 400, 'C'.repeat(40), 'm'),
    ).failure_code;
    expect(code).toHaveLength(30);
  });
});
