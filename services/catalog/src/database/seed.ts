import { DataSource } from 'typeorm';
import { Category } from './entities/category.entity';
import { Industry } from './entities/industry.entity';
import { Product } from './entities/product.entity';
import { ProductImage } from './entities/product-image.entity';

// Dữ liệu demo — guides/NT_Docker_Local_Guide.md §5. Id cố định để order, Postman, k6, thí nghiệm dùng chung.
export const SEED_INDUSTRY_ID = 'bbbbbbbb-0000-4000-8000-000000000001';
export const SEED_CATEGORY_ID = 'bbbbbbbb-0000-4000-8000-000000000011';
export const SEED_PRODUCT = {
  /** 200.000đ, tồn 100.000, có ảnh — dùng cho đo tải */
  NHIEU: 'bbbbbbbb-0000-4000-8000-000000000101',
  /** 800.000đ, tồn 100.000 */
  DAT: 'bbbbbbbb-0000-4000-8000-000000000102',
  /** 100.000đ, tồn 5 — thử hết hàng (BR-01) */
  IT: 'bbbbbbbb-0000-4000-8000-000000000103',
  /** is_active=false — thử sản phẩm không khả dụng */
  TAT: 'bbbbbbbb-0000-4000-8000-000000000104',
} as const;
export const SEED_IMAGE_ID = 'bbbbbbbb-0000-4000-8000-000000001001';

/**
 * Idempotent: INSERT ... ON CONFLICT DO NOTHING theo id, trong một transaction.
 * Chạy lại không ghi đè dữ liệu đã có (kể cả tồn kho đã bị trừ). Trả số sản phẩm vừa thêm.
 */
export async function seedDemo(ds: DataSource): Promise<number> {
  return ds.transaction(async (m) => {
    await m
      .createQueryBuilder()
      .insert()
      .into(Industry)
      .values({ id: SEED_INDUSTRY_ID, name: 'Điện tử', sort_order: 1 })
      .orIgnore()
      .execute();

    await m
      .createQueryBuilder()
      .insert()
      .into(Category)
      .values({
        id: SEED_CATEGORY_ID,
        name: 'Tai nghe',
        sortOrder: 1,
        industry_id: SEED_INDUSTRY_ID,
      })
      .orIgnore()
      .execute();

    const products = await m
      .createQueryBuilder()
      .insert()
      .into(Product)
      .values([
        {
          id: SEED_PRODUCT.NHIEU,
          name: 'Tai nghe NexTech Basic (SP-NHIEU)',
          category_id: SEED_CATEGORY_ID,
          brand: 'NexTech',
          price: 200000,
          stock_quantity: 100000,
          is_active: true,
        },
        {
          id: SEED_PRODUCT.DAT,
          name: 'Tai nghe NexTech Pro (SP-DAT)',
          category_id: SEED_CATEGORY_ID,
          brand: 'NexTech',
          price: 800000,
          stock_quantity: 100000,
          is_active: true,
        },
        {
          id: SEED_PRODUCT.IT,
          name: 'Tai nghe NexTech Mini (SP-IT)',
          category_id: SEED_CATEGORY_ID,
          brand: 'NexTech',
          price: 100000,
          stock_quantity: 5,
          is_active: true,
        },
        {
          id: SEED_PRODUCT.TAT,
          name: 'Tai nghe NexTech Cũ (SP-TAT)',
          category_id: SEED_CATEGORY_ID,
          brand: 'NexTech',
          price: 150000,
          stock_quantity: 10,
          is_active: false,
        },
      ])
      .orIgnore()
      .returning('id')
      .execute();

    await m
      .createQueryBuilder()
      .insert()
      .into(ProductImage)
      .values({
        id: SEED_IMAGE_ID,
        product_id: SEED_PRODUCT.NHIEU,
        // Ảnh nhập bằng URL (public_id rỗng): không cần Cloudinary thật
        image_url: 'https://res.cloudinary.com/demo/image/upload/sample.jpg',
        public_id: null,
        is_primary: true,
        sort_order: 0,
      })
      .orIgnore()
      .execute();

    return (products.raw as unknown[]).length;
  });
}
