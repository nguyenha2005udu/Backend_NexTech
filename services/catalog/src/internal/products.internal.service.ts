import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In } from 'typeorm';
import { Product } from '../database/entities/product.entity';
import { ProductImage } from '../database/entities/product-image.entity';

export interface ProductBatchItem {
  id: string;
  name: string;
  price: number;
  stock_quantity: number;
  is_active: boolean;
  image: string | null;
}

// API nội bộ đọc sản phẩm cho service khác (NT.CATALOG API_Spec §2). Thay cho JOIN sang bảng của catalog.
@Injectable()
export class ProductsInternalService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Tối đa 100 id (DTO chặn). Id không tồn tại thì bỏ qua.
   * Số truy vấn: 2 cố định (sản phẩm + ảnh is_primary); mảng rỗng 0.
   */
  async findBatch(ids: string[]): Promise<{ items: ProductBatchItem[] }> {
    if (!ids.length) return { items: [] };

    const [products, images] = await Promise.all([
      this.dataSource.getRepository(Product).find({
        select: {
          id: true,
          name: true,
          price: true,
          stock_quantity: true,
          is_active: true,
        },
        where: { id: In(ids) },
      }),
      this.dataSource.getRepository(ProductImage).find({
        select: { product_id: true, image_url: true },
        where: { product_id: In(ids), is_primary: true },
      }),
    ]);

    const primary = new Map<string, string>();
    for (const img of images) {
      if (!primary.has(img.product_id))
        primary.set(img.product_id, img.image_url);
    }

    return {
      items: products.map((p) => ({
        id: p.id,
        name: p.name,
        // bigint từ pg là chuỗi
        price: Number(p.price),
        stock_quantity: p.stock_quantity,
        is_active: p.is_active,
        image: primary.get(p.id) ?? null,
      })),
    };
  }

  /**
   * Chép từ be/src/admin/statistics/statistics.admin.service.ts (phần đếm sản phẩm).
   * Số truy vấn: 2.
   */
  async stats(): Promise<{ total_products: number; active_products: number }> {
    const repo = this.dataSource.getRepository(Product);
    const [total, active] = await Promise.all([
      repo.count(),
      repo.count({ where: { is_active: true } }),
    ]);
    return { total_products: total, active_products: active };
  }
}
