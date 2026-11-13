import { calculate } from './discount-calculator';

// BR-05 — công thức giữ nguyên từ be/src/users/order/order.service.ts (checkout)
// và be/src/users/discountcode/discountcode.service.ts (validate).
describe('calculate (BR-05)', () => {
  const percent = (value: number, max: number | null = null) => ({
    discount_type: 'percent' as const,
    discount_value: value,
    max_discount: max,
  });
  const fixed = (value: number) => ({
    discount_type: 'fixed_amount' as const,
    discount_value: value,
    max_discount: null,
  });

  it('percent không có max_discount: cơ_sở × giá_trị / 100', () => {
    expect(calculate(percent(10), 1_500_000)).toBe(150_000);
  });

  it('percent có max_discount: không vượt max_discount', () => {
    expect(calculate(percent(10, 100_000), 1_500_000)).toBe(100_000);
  });

  it('percent có max_discount lớn hơn số tính được: giữ số tính được', () => {
    expect(calculate(percent(10, 200_000), 1_500_000)).toBe(150_000);
  });

  it('fixed_amount nhỏ hơn cơ sở: giảm đúng giá trị', () => {
    expect(calculate(fixed(30_000), 50_000)).toBe(30_000);
  });

  it('fixed_amount vượt cơ sở: không vượt cơ sở', () => {
    expect(calculate(fixed(30_000), 20_000)).toBe(20_000);
  });

  it('cơ sở bằng 0 (phí ship 0): giảm 0', () => {
    expect(calculate(fixed(30_000), 0)).toBe(0);
    expect(calculate(percent(50), 0)).toBe(0);
  });

  it('làm tròn về số nguyên VND', () => {
    expect(calculate(percent(15), 33_333)).toBe(5_000); // 4999.95 → 5000
  });

  it('bigint từ pg dạng chuỗi vẫn tính đúng', () => {
    const fromDb = {
      discount_type: 'percent' as const,
      discount_value: '10' as unknown as number,
      max_discount: '100000' as unknown as number,
    };
    expect(calculate(fromDb, 1_500_000)).toBe(100_000);
  });
});
