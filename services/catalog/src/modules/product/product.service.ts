// Chép từ be/src/users/product/product.service.ts. Đổi do tách service (Component_Class_Design §2):
// - NotFoundException('Không tìm thấy sản phẩm') → BusinessException NT-CAT-1005 (giữ câu chữ).
// - findReviews: bỏ relations user, đọc snapshot user_name/user_avatar_url.
// - Bỏ orderItemRepo, import Order/OrderItem/User. createReview tạm trả 503 tới T2.5
//   (gọi OrderClient.hasPurchased, IdentityClient.getUser — Processing_Flow §3).
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { UpstreamError } from '@nextech/service-kit';
import { Repository } from 'typeorm';
import { Product } from '../../database/entities/product.entity';
import { ProductReview } from '../../database/entities/product-review.entity';
import { productNotFound } from '../../errors';
import {
  CreateProductReviewDto,
  QueryProductDto,
  QueryProductReviewDto,
} from './product.dto';

@Injectable()
export class ProductService {
  constructor(
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    @InjectRepository(ProductReview)
    private readonly reviewRepo: Repository<ProductReview>,
  ) {}

  // ---------- GET /api/products ----------
  async findAll(query: QueryProductDto) {
    const {
      search,
      categoryId,
      brand,
      tag,
      minPrice,
      maxPrice,
      sort,
      page = 1,
      limit = 20,
    } = query;

    const qb = this.productRepo
      .createQueryBuilder('product')
      .leftJoinAndSelect('product.category', 'category')
      .leftJoinAndSelect('product.tags', 'tags')
      .leftJoinAndSelect(
        'product.images',
        'primaryImage',
        'primaryImage.is_primary = true',
      )
      .where('product.is_active = true');

    if (search) {
      // Tên sản phẩm phần lớn là tiếng Anh ("Apple Watch...") trong khi khách gõ
      // "đồng hồ" — khớp thêm tên danh mục để từ khoá tiếng Việt không ra 0 kết quả.
      qb.andWhere(
        '(product.name ILIKE :search OR category.name ILIKE :search)',
        {
          search: `%${search}%`,
        },
      );
    }
    if (categoryId) {
      qb.andWhere('product.category_id = :categoryId', { categoryId });
    }
    if (brand) {
      qb.andWhere('product.brand ILIKE :brand', { brand: `%${brand}%` });
    }
    if (tag) {
      qb.andWhere('tags.name ILIKE :tag', { tag: `%${tag}%` });
    }
    if (minPrice !== undefined) {
      qb.andWhere('product.price >= :minPrice', { minPrice });
    }
    if (maxPrice !== undefined) {
      qb.andWhere('product.price <= :maxPrice', { maxPrice });
    }

    switch (sort) {
      case 'price_asc':
        qb.orderBy('product.price', 'ASC');
        break;
      case 'price_desc':
        qb.orderBy('product.price', 'DESC');
        break;
      case 'rating_desc':
        qb.orderBy('product.rating', 'DESC');
        break;
      case 'newest':
      default:
        qb.orderBy('product.created_at', 'DESC');
    }

    qb.skip((page - 1) * limit).take(limit);

    const [items, total] = await qb.getManyAndCount();

    return {
      items: items.map((p) => this.toListItem(p)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  private toListItem(p: Product) {
    return {
      id: p.id,
      name: p.name,
      brand: p.brand,
      price: p.price,
      rating: p.rating,
      primary_image: p.images?.[0]?.image_url ?? null,
      category_name: p.category?.name ?? null,
      tags: p.tags?.map((t) => t.name) ?? [],
    };
  }

  // ---------- GET /api/products/brands ----------
  /** Danh sách các hãng (brand) đang có sản phẩm active - phục vụ filter UI */
  async findAllBrands(): Promise<string[]> {
    const rows = await this.productRepo
      .createQueryBuilder('product')
      .select('DISTINCT product.brand', 'brand')
      .where('product.is_active = true')
      .andWhere('product.brand IS NOT NULL')
      .orderBy('product.brand', 'ASC')
      .getRawMany<{ brand: string }>();
    return rows.map((r) => r.brand);
  }

  /** Danh mục đang có sản phẩm active — /internal/products/facets dùng ở T8.4 */
  async findAllCategories(): Promise<{ id: string; name: string }[]> {
    return this.productRepo
      .createQueryBuilder('product')
      .innerJoin('product.category', 'category')
      .select('category.id', 'id')
      .addSelect('category.name', 'name')
      .distinct(true)
      .where('product.is_active = true')
      .orderBy('category.name', 'ASC')
      .getRawMany<{ id: string; name: string }>();
  }

  // ---------- GET /api/products/:id ----------
  async findOne(id: string) {
    const product = await this.productRepo.findOne({
      where: { id, is_active: true },
      relations: { category: true, images: true, specs: true, tags: true },
    });
    if (!product) throw productNotFound();

    const reviewCount = await this.reviewRepo.count({
      where: { product_id: id },
    });

    return { ...product, review_count: reviewCount };
  }

  // ---------- GET /api/products/:id/specs ----------
  async findSpecs(id: string) {
    const product = await this.productRepo.findOne({
      where: { id, is_active: true },
      relations: { specs: true },
    });
    if (!product) throw productNotFound();

    return product.specs.map((s) => ({
      spec_key: s.spec_key,
      spec_value: s.spec_value,
      spec_unit: s.spec_unit,
    }));
  }

  // ---------- GET /api/products/:id/reviews ----------
  async findReviews(id: string, query: QueryProductReviewDto) {
    const { page = 1, limit = 20 } = query;

    const [items, total] = await this.reviewRepo.findAndCount({
      where: { product_id: id },
      order: { created_at: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      items: items.map((r) => ({
        id: r.id,
        // Snapshot lúc tạo đánh giá (T2.5). be/ đọc users.full_name, avatar_url qua JOIN
        user_name: r.user_name ?? 'Ẩn danh',
        avatar_url: r.user_avatar_url ?? null,
        rating: r.rating,
        title: r.title,
        content: r.content,
        created_at: r.created_at,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // ---------- POST /api/products/:id/reviews ----------
  // Tạm thời tới T2.5: BR-11 cần hỏi order-service đã mua chưa (Processing_Flow §3).
  // eslint-disable-next-line @typescript-eslint/require-await
  async createReview(
    productId: string,
    userId: string,
    dto: CreateProductReviewDto,
  ): Promise<ProductReview> {
    void productId;
    void userId;
    void dto;
    throw new UpstreamError(
      'order',
      'Tạo đánh giá chưa nối order-service (T2.5)',
      'not_executed',
    );
  }
}
