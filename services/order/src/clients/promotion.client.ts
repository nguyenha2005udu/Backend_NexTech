import type { ResilientHttpClient } from '@nextech/service-kit';
import type { CallOptions } from './catalog.client';

/** Body `POST /internal/redemptions` (NT.PROMOTION API_Spec). Có ít nhất một trong hai mã. */
export interface RedeemRequest {
  order_id: string;
  subtotal: number;
  shipping_fee: number;
  discount_code?: string;
  freeship_code?: string;
}

export interface RedeemResult {
  order_id: string;
  status: 'redeemed';
  discount_code_id: string | null;
  freeship_code_id: string | null;
  discount_amount: number;
  shipping_discount_amount: number;
}

// Client tới promotion-service (NT.ORDER Component_Class_Design §5), dùng trong saga (T3.3–T3.5).
// Cả hai lệnh idempotent theo order_id nên được retry. Lỗi truyền nguyên.
export class PromotionClient {
  constructor(private readonly http: Pick<ResilientHttpClient, 'request'>) {}

  redeem(dto: RedeemRequest, opts: CallOptions = {}): Promise<RedeemResult> {
    return this.http.request({
      method: 'POST',
      path: '/internal/redemptions',
      body: dto,
      retry: true,
      deadline: opts.deadline,
    });
  }

  release(
    orderId: string,
    opts: CallOptions = {},
  ): Promise<{ status: 'released'; restored: boolean }> {
    return this.http.request({
      method: 'DELETE',
      path: `/internal/redemptions/${encodeURIComponent(orderId)}`,
      retry: true,
      deadline: opts.deadline,
    });
  }
}
