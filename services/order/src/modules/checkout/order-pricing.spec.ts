import { shippingFeeFor, subtotalOf, totalOf } from './order-pricing';

// BR-04 (phí ship), BR-05 (tổng tiền). Công thức chép be/src/users/order/order.service.ts dòng 136–207,
// phần tính giảm giá nay ở promotion (discount-calculator) — order chỉ nhận số tiền.
describe('order-pricing', () => {
  const cfg = { shippingFee: 30_000, freeShippingThreshold: 500_000 };

  it('subtotal = tổng giá × số lượng', () => {
    expect(
      subtotalOf([
        { unit_price: 150_000, quantity: 2 },
        { unit_price: 99_999, quantity: 1 },
      ]),
    ).toBe(399_999);
  });

  it('499.999đ có phí ship 30.000đ', () => {
    expect(shippingFeeFor(499_999, cfg)).toBe(30_000);
  });

  it('500.000đ miễn phí ship (>= ngưỡng)', () => {
    expect(shippingFeeFor(500_000, cfg)).toBe(0);
  });

  it('phí và ngưỡng đổi được qua cấu hình', () => {
    expect(
      shippingFeeFor(100_000, {
        shippingFee: 15_000,
        freeShippingThreshold: 100_000,
      }),
    ).toBe(0);
    expect(
      shippingFeeFor(99_999, {
        shippingFee: 15_000,
        freeShippingThreshold: 100_000,
      }),
    ).toBe(15_000);
  });

  it('total = subtotal + ship − giảm giá − giảm ship (BR-05)', () => {
    expect(totalOf(1_500_000, 0, 150_000, 0)).toBe(1_350_000);
    expect(totalOf(200_000, 30_000, 20_000, 30_000)).toBe(180_000);
  });

  it('không có mã: total = subtotal + ship', () => {
    expect(totalOf(200_000, 30_000)).toBe(230_000);
  });
});
