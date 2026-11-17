// Chép từ be/src/users/industry/industry.service.ts. Đổi:
// - findAll đếm sản phẩm bằng một truy vấn GROUP BY thay vì count từng danh mục trong vòng lặp
//   (quyết định B12, NT.CATALOG Processing_Flow §5). Response giữ nguyên.
// - Bỏ categoryRepo, imageRepo: be/ inject nhưng không dùng.
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Industry } from '../../database/entities/industry.entity';
import { Product } from '../../database/entities/product.entity';
import { IndustryQueryDto } from './industry.dto';

@Injectable()
export class IndustryService {
  constructor(
    @InjectRepository(Industry)
    private readonly industryRepo: Repository<Industry>,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
  ) {}

  // GET /api/industries - Danh sách ngành học với categories (ko products)
  async findAll() {
    const industries = await this.industryRepo.find({
      where: { is_active: true },
      relations: { categories: true },
      order: { sort_order: 'ASC' },
    });

    const activeByIndustry = industries.map((industry) =>
      industry.categories
        .filter((c) => c.isActive)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    );

    // Đếm sản phẩm đang bán của mọi danh mục trong một truy vấn (B12)
    const counts = await this.countActiveProducts(
      activeByIndustry.flat().map((c) => c.id),
    );

    const industriesWithCounts = industries.map((industry, i) => ({
      id: industry.id,
      name: industry.name,
      icon: industry.icon,
      sort_order: industry.sort_order,
      categories: activeByIndustry[i].map((category) => ({
        id: category.id,
        name: category.name,
        icon: category.icon,
        sort_order: category.sortOrder,
        product_count: counts.get(category.id) ?? 0,
      })),
    }));

    return {
      items: industriesWithCounts,
      total: industriesWithCounts.length,
    };
  }

  /** category_id → số sản phẩm is_active. Không có danh mục thì không truy vấn */
  private async countActiveProducts(
    categoryIds: string[],
  ): Promise<Map<string, number>> {
    if (!categoryIds.length) return new Map();
    const rows = await this.productRepo
      .createQueryBuilder('product')
      .select('product.category_id', 'category_id')
      .addSelect('COUNT(*)', 'count')
      .where('product.category_id IN (:...ids)', { ids: categoryIds })
      .andWhere('product.is_active = true')
      .groupBy('product.category_id')
      .getRawMany<{ category_id: string; count: string }>();
    // COUNT(*) của Postgres là bigint → pg trả chuỗi; be/ trả số (Repository.count)
    return new Map(rows.map((r) => [r.category_id, Number(r.count)]));
  }

  // GET /api/industries/:id - Chi tiết ngành học với categories và products
  async findOne(id: string, query: IndustryQueryDto) {
    const { include_products = false, page = 1, limit = 20 } = query;

    // B17: một câu SELECT ... LEFT JOIN, không take. findOne kèm relations khiến TypeORM tách thêm câu
    // lấy id (DISTINCT) nên vượt ngưỡng số truy vấn (non-functional §1). Kết quả giống be/.
    const industry = await this.industryRepo
      .createQueryBuilder('industry')
      .leftJoinAndSelect('industry.categories', 'category')
      .where('industry.id = :id', { id })
      .andWhere('industry.is_active = true')
      .getOne();
    if (!industry) {
      throw new NotFoundException('Không tìm thấy ngành học');
    }

    // Lọc và sắp xếp categories active
    const activeCategories = industry.categories
      .filter((c) => c.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder);

    if (!include_products) {
      return {
        id: industry.id,
        name: industry.name,
        icon: industry.icon,
        categories: activeCategories.map((c) => ({
          id: c.id,
          name: c.name,
          icon: c.icon,
          sort_order: c.sortOrder,
        })),
      };
    }

    // Với products - lấy products cho tất cả categories trong ngành
    const categoryIds = activeCategories.map((c) => c.id);

    // Query builder để lấy products với pagination
    const qb = this.productRepo
      .createQueryBuilder('product')
      .leftJoinAndSelect('product.category', 'category')
      .leftJoinAndSelect(
        'product.images',
        'primaryImage',
        'primaryImage.is_primary = true',
      )
      .where('product.category_id IN (:...categoryIds)', { categoryIds })
      .andWhere('product.is_active = true');

    const total = await qb.getCount();

    qb.orderBy('category.sortOrder', 'ASC')
      .addOrderBy('product.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const products = await qb.getMany();

    // Group products by category
    const productsByCategory = new Map<string, typeof products>();
    for (const product of products) {
      const catId = product.category_id as string; // Safe: we queried only products with category_id in list
      if (!productsByCategory.has(catId)) {
        productsByCategory.set(catId, []);
      }
      productsByCategory.get(catId)!.push(product);
    }

    const categoriesWithProducts = activeCategories.map((category) => {
      const catProducts = productsByCategory.get(category.id) ?? [];
      return {
        id: category.id,
        name: category.name,
        icon: category.icon,
        sort_order: category.sortOrder,
        products: catProducts.map((p) => ({
          id: p.id,
          name: p.name,
          brand: p.brand,
          price: p.price,
          rating: p.rating,
          primary_image: p.images?.[0]?.image_url ?? null,
        })),
      };
    });

    return {
      id: industry.id,
      name: industry.name,
      icon: industry.icon,
      categories: categoriesWithProducts,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
