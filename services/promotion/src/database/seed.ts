import { DataSource } from 'typeorm';
import { DiscountCode } from './entities/discount-code.entity';

const DAY = 24 * 60 * 60 * 1000;

// Mã demo — guides/NT_Docker_Local_Guide.md §5. Id cố định để Postman, thí nghiệm dùng chung.
function demoCodes(now: Date): Partial<DiscountCode>[] {
  return [
    {
      id: 'cccccccc-0000-4000-8000-000000000001',
      code: 'SALE10',
      description: 'Giảm 10%, tối đa 200.000đ',
      category: 'order',
      discount_type: 'percent',
      discount_value: 10,
      max_discount: 200_000,
    },
    {
      id: 'cccccccc-0000-4000-8000-000000000002',
      code: 'SHIP30',
      description: 'Giảm 30.000đ phí ship',
      category: 'free_shipping',
      discount_type: 'fixed_amount',
      discount_value: 30_000,
    },
    {
      id: 'cccccccc-0000-4000-8000-000000000003',
      code: 'HETHAN',
      description: 'Mã đã hết hạn (kiểm thử NT-PRM-1005)',
      category: 'order',
      discount_type: 'percent',
      discount_value: 10,
      valid_until: new Date(now.getTime() - DAY),
    },
    {
      id: 'cccccccc-0000-4000-8000-000000000004',
      code: 'HETLUOT',
      description: 'Mã đã hết lượt (kiểm thử NT-PRM-1006)',
      category: 'order',
      discount_type: 'percent',
      discount_value: 10,
      usage_limit: 1,
      used_count: 1,
    },
    {
      id: 'cccccccc-0000-4000-8000-000000000005',
      code: 'TOITHIEU',
      description: 'Đơn tối thiểu 50.000.000đ (kiểm thử NT-PRM-1007)',
      category: 'order',
      discount_type: 'percent',
      discount_value: 10,
      min_order_value: 50_000_000,
    },
  ];
}

/** Idempotent: một lệnh INSERT ... ON CONFLICT DO NOTHING, chạy lại không đổi mã đã có. */
export async function seedDemo(
  ds: DataSource,
  now = new Date(),
): Promise<number> {
  const result = await ds
    .createQueryBuilder()
    .insert()
    .into(DiscountCode)
    .values(demoCodes(now))
    .orIgnore()
    .returning('id')
    .execute();
  return (result.raw as unknown[]).length;
}
