// Tính số tiền giảm (BR-05) — hàm thuần, không đụng DB (NT.PROMOTION Component_Class_Design §2).
// Công thức chép từ be/src/users/order/order.service.ts (checkout) — cùng công thức với
// be/src/users/discountcode/discountcode.service.ts (validate), nên cả hai nơi dùng chung hàm này.

export interface DiscountRule {
  discount_type: 'percent' | 'fixed_amount';
  discount_value: number;
  max_discount: number | null;
}

/**
 * percent:      giảm = cơ_sở × giá_trị / 100, không quá max_discount
 * fixed_amount: giảm = giá_trị
 * Sau đó:       giảm = round(min(giảm, cơ_sở))
 *
 * `base`: subtotal với mã `order`, shipping_fee với mã `free_shipping`.
 * Cột bigint từ pg là chuỗi nên luôn Number() (api-convention §8).
 */
export function calculate(rule: DiscountRule, base: number): number {
  let amount: number;
  if (rule.discount_type === 'percent') {
    amount = (base * Number(rule.discount_value)) / 100;
    if (rule.max_discount !== null) {
      amount = Math.min(amount, Number(rule.max_discount));
    }
  } else {
    amount = Number(rule.discount_value);
  }
  return Math.round(Math.min(amount, base));
}
