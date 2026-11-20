// Hàm thuần tính tiền đơn (NT.CHECKOUT_SAGA Component_Class_Design §1). Chép công thức
// be/src/users/order/order.service.ts dòng 136–207: subtotal, phí ship BR-04, tổng BR-05.
// Phần tính số tiền giảm của be/ nay ở promotion (discount-calculator, T2.1): order chỉ nhận
// discount_amount, shipping_discount_amount từ POST /internal/redemptions, không tính lại.

export interface PricingConfig {
  shippingFee: number;
  freeShippingThreshold: number;
}

export interface PricedLine {
  unit_price: number;
  quantity: number;
}

export function subtotalOf(lines: PricedLine[]): number {
  return lines.reduce((sum, l) => sum + l.unit_price * l.quantity, 0);
}

// BR-04: đơn từ ngưỡng trở lên miễn phí ship
export function shippingFeeFor(subtotal: number, cfg: PricingConfig): number {
  return subtotal >= cfg.freeShippingThreshold ? 0 : cfg.shippingFee;
}

// BR-05
export function totalOf(
  subtotal: number,
  shippingFee: number,
  discountAmount = 0,
  shippingDiscountAmount = 0,
): number {
  return subtotal + shippingFee - discountAmount - shippingDiscountAmount;
}
