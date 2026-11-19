// Chép từ be/src/users/product/product.service.ts. Đổi do tách service (Component_Class_Design §2):
// - NotFoundException('Không tìm thấy sản phẩm') → BusinessException NT-CAT-1005 (giữ câu chữ).
// - findReviews: bỏ relations user, đọc snapshot user_name/user_avatar_url.
// - Bỏ orderItemRepo, import Order/OrderItem/User. createReview hỏi order qua OrderClient (BR-11) thay JOIN
//   order_items, lưu snapshot tên từ IdentityClient (Processing_Flow §3, T2.5). Lỗi có mã NT-CAT-1006/1007.
import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { BusinessException } from '@nextech/service-kit';
import { Repository } from 'typeorm';
import { Product } from '../../database/entities/product.entity';
import { ProductReview } from '../../database/entities/product-review.entity';
import { IdentityClient } from '../../clients/identity.client';
import { OrderClient } from '../../clients/order.client';
import { isUniqueViolation } from '../../database/unique-violation';
import { CAT_ERROR, productNotFound } from '../../errors';
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
    private readonly orders: OrderClient,
    private readonly identity: IdentityClient,
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

  /**
   * BR-11 (be/ createReview + NT.CATALOG Processing_Flow §3). Không bọc transaction: không giữ
   * transaction khi gọi HTTP (coding-convention §4). Số truy vấn 3 (sản phẩm, đã đánh giá, chèn),
   * lời gọi HTTP 2 cố định (order, identity).
   */
  async createReview(
    productId: string,
    userId: string,
    dto: CreateProductReviewDto,
  ): Promise<ProductReview> {
    // be/: chỉ kiểm tồn tại, không lọc is_active
    const product = await this.productRepo.findOne({
      where: { id: productId },
    });
    if (!product) throw productNotFound();

    // Order lỗi → 503/504 (OrderClient), không tạo
    if (!(await this.orders.hasPurchased(userId, productId))) {
      throw new BusinessException(
        HttpStatus.FORBIDDEN,
        CAT_ERROR.REVIEW_NOT_PURCHASED,
        'Bạn cần mua sản phẩm này (đơn hàng đã hoàn tất) trước khi đánh giá',
      );
    }

    const existed = await this.reviewRepo.findOne({
      where: { product_id: productId, user_id: userId },
    });
    if (existed) throw reviewExists();

    // Identity lỗi → null: vẫn tạo, hiển thị "Ẩn danh" (API_Spec §3)
    const snapshot = await this.identity.getUserSnapshot(userId);

    const review = this.reviewRepo.create({
      product_id: productId,
      user_id: userId,
      user_name: snapshot?.full_name ?? null,
      user_avatar_url: snapshot?.avatar_url ?? null,
      rating: String(dto.rating),
      title: dto.title ?? null,
      content: dto.content ?? null,
    });
    try {
      return await this.reviewRepo.save(review);
    } catch (err) {
      // Hai request cùng lúc cùng vượt bước kiểm tra đọc: unique index chặn, trả đúng mã như trên (B1)
      if (isUniqueViolation(err, 'ux_reviews_user_product')) {
        throw reviewExists();
      }
      throw err;
    }
  }
}

const reviewExists = () =>
  new BusinessException(
    HttpStatus.FORBIDDEN,
    CAT_ERROR.REVIEW_EXISTS,
    'Bạn đã đánh giá sản phẩm này rồi',
  );
