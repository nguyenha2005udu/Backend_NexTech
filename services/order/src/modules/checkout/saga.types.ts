// Kiểu và hàm nhỏ của saga đặt hàng (NT.CHECKOUT_SAGA Component_Class_Design §3–4). Chỉ saga dùng.
import type { HttpException } from '@nestjs/common';
import { BusinessException, GEN_ERROR } from '@nextech/service-kit';
import type { Order } from '../../database/entities/order.entity';

// orders.saga_step (API_Spec §3)
export type SagaStep =
  | 'started'
  | 'stock_reserved'
  | 'promotion_redeemed'
  | 'confirmed'
  | 'compensating'
  | 'compensated';

export type SagaOutcome =
  | { kind: 'confirmed'; order: Order }
  | { kind: 'failed'; error: HttpException } // đã bắt đầu hoàn tác (T3.4)
  | { kind: 'in_doubt'; order: Order }; // chưa rõ, đối soát làm tiếp

// Bên khác (request hoặc cron) đã đổi đơn: setStep không khớp bước mong đợi
export class SagaPreempted extends Error {
  constructor() {
    super('Saga đã bị bên khác xử lý');
  }
}

// "Còn dưới 1 giây thì dừng gọi, trả 202" (API_Spec §5). Không có deadline (cron) thì không hết.
const BUDGET_RESERVE_MS = 1000;

export function isBudgetExhausted(
  deadline: number | undefined,
  now = Date.now(),
): boolean {
  return deadline !== undefined && deadline - now < BUDGET_RESERVE_MS;
}

// Lỗi đã lưu của đơn failed (Component_Class_Design §6 lưu failure_*), dùng khi trả lại kết quả cũ
export function failureError(order: Order): BusinessException {
  return new BusinessException(
    order.failure_status ?? 500,
    order.failure_code ?? GEN_ERROR.INTERNAL,
    order.failure_message ?? 'Đặt hàng thất bại',
  );
}

// Đơn đã có kết quả (hoặc đang chạy dở) → SagaOutcome, không gọi gì thêm
export function toOutcome(order: Order): SagaOutcome {
  if (order.status === 'processing') return { kind: 'in_doubt', order };
  if (order.status === 'failed') {
    return { kind: 'failed', error: failureError(order) };
  }
  return { kind: 'confirmed', order };
}
