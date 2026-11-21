// Kiểu và hàm nhỏ của saga đặt hàng (NT.CHECKOUT_SAGA Component_Class_Design §3–4). Chỉ saga dùng.
import type { HttpException } from '@nestjs/common';
import {
  BusinessException,
  codeForStatus,
  GEN_ERROR,
  UpstreamBusinessError,
  UpstreamError,
} from '@nextech/service-kit';
import type { Order } from '../../database/entities/order.entity';

// orders.failure_code là varchar(30) (NT.ORDER API_Spec §5)
const FAILURE_CODE_MAX = 30;

// Lỗi làm saga thất bại → cột failure_* (Component_Class_Design §6, v1.6). Mã giống mã AllExceptionsFilter
// trả cho client: đích không gửi code thì codeForStatus (service-kit).
export function failureFieldsOf(reason: HttpException): {
  failure_code: string;
  failure_message: string;
  failure_status: number;
} {
  const status = reason.getStatus();
  let code: string;
  if (reason instanceof UpstreamBusinessError) {
    code = reason.upstreamCode ?? codeForStatus(status);
  } else if (
    reason instanceof UpstreamError ||
    reason instanceof BusinessException
  ) {
    code = reason.code;
  } else {
    code = codeForStatus(status);
  }
  const res = reason.getResponse();
  // getResponse(): chuỗi, mảng (UpstreamBusinessError giữ message mảng của đích) hoặc { message }
  const raw = Array.isArray(res)
    ? res
    : typeof res === 'object' && res !== null && 'message' in res
      ? res.message
      : reason.message;
  return {
    failure_code: code.slice(0, FAILURE_CODE_MAX),
    failure_message: Array.isArray(raw) ? raw.join('; ') : String(raw),
    failure_status: status,
  };
}

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

// Đơn quá SAGA_DEADLINE_MS mà đối soát chưa xong (Component_Class_Design §7, v1.7). Lỗi hạ tầng (≥ 500)
// nên startForFailedSaga nhả Idempotency-Key: gửi lại cùng key thì tạo đơn mới.
export function timeoutError(): BusinessException {
  return new BusinessException(
    504,
    GEN_ERROR.UPSTREAM_TIMEOUT,
    'Đặt hàng quá thời gian xử lý, vui lòng thử lại',
  );
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
