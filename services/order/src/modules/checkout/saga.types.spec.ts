import { BusinessException } from '@nextech/service-kit';
import type { Order } from '../../database/entities/order.entity';
import { isBudgetExhausted, toOutcome } from './saga.types';

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
