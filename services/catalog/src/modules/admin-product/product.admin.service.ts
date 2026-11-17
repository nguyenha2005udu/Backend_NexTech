// Chép từ be/src/admin/product/product.admin.service.ts. Đổi do tách service (Component_Class_Design §2):
// - "Không tìm thấy sản phẩm" → BusinessException 404 NT-CAT-1005; thiếu ảnh → 400 NT-CAT-1010 (giữ câu chữ).
//   Các 404 khác (ảnh, thông số, tag) không có mã riêng → giữ NotFoundException, filter gắn NT-GEN-0004.
// - remove: xoá ảnh Cloudinary song song (quyết định B14, Processing_Flow §6). Mỗi lệnh có timeout 5 s
//   trong CloudinaryService và vốn nuốt lỗi như be/.
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { BusinessException } from '@nextech/service-kit';
import { Repository } from 'typeorm';
import { Product } from '../../database/entities/product.entity';
import { ProductImage } from '../../database/entities/product-image.entity';
import { ProductSpec } from '../../database/entities/product-spec.entity';
import { ProductReview } from '../../database/entities/product-review.entity';
import { Tag } from '../../database/entities/tag.entity';
import { CloudinaryService } from '../../cloudinary/cloudinary.service';
import {
  CreateProductDto,
  CreateProductImageDto,
  CreateProductSpecDto,
  CreateProductTagDto,
  QueryAdminProductDto,
  UpdateProductDto,
  UpdateProductImageDto,
  UpdateProductSpecDto,
} from './product.admin.dto';
import { CAT_ERROR, productNotFound } from '../../errors';

@Injectable()
export class AdminProductService {
  constructor(
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    @InjectRepository(ProductImage)
    private readonly imageRepo: Repository<ProductImage>,
    @InjectRepository(ProductSpec)
    private readonly specRepo: Repository<ProductSpec>,
    @InjectRepository(Tag)
    private readonly tagRepo: Repository<Tag>,
    @InjectRepository(ProductReview)
    private readonly reviewRepo: Repository<ProductReview>,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  private async findProductOrFail(id: string): Promise<Product> {
    const product = await this.productRepo.findOne({ where: { id } });
    if (!product) throw productNotFound();
    return product;
  }

  // GET /api/admin/products
  async findAll(query: QueryAdminProductDto) {
    const {
      search,
      categoryId,
      brand,
      isActive,
      sort,
      page = 1,
      limit = 20,
    } = query;
    const buildFilteredQb = () => {
      const qb = this.productRepo.createQueryBuilder('product');
      if (search) {
        qb.andWhere('product.name ILIKE :search', { search: `%${search}%` });
      }
      if (categoryId) {
        qb.andWhere('product.category_id = :categoryId', { categoryId });
      }
      if (brand) {
        qb.andWhere('product.brand ILIKE :brand', { brand: `%${brand}%` });
      }
      if (isActive !== undefined) {
        qb.andWhere('product.is_active = :isActive', { isActive });
      }
      return qb;
    };

    const total = await buildFilteredQb().getCount();

    if (total === 0) {
      return { items: [], total: 0, page, limit, totalPages: 0 };
    }

    const idQb = buildFilteredQb().select(['product.id']);
    switch (sort) {
      case 'price_asc':
        idQb.orderBy('product.price', 'ASC');
        break;
      case 'price_desc':
        idQb.orderBy('product.price', 'DESC');
        break;
      case 'rating_desc':
        idQb.orderBy('product.rating', 'DESC');
        break;
      case 'newest':
      default:
        idQb.orderBy('product.created_at', 'DESC');
    }
    idQb.skip((page - 1) * limit).take(limit);

    const pageRows = await idQb.getMany();
    const ids = pageRows.map((p) => p.id);

    const detailed = await this.productRepo
      .createQueryBuilder('product')
      .leftJoinAndSelect('product.category', 'category')
      .leftJoinAndSelect('product.images', 'images')
      .whereInIds(ids)
      .addOrderBy('images.is_primary', 'DESC')
      .addOrderBy('images.sort_order', 'ASC')
      .getMany();

    const orderIndex = new Map(ids.map((id, idx) => [id, idx]));
    detailed.sort((a, b) => orderIndex.get(a.id)! - orderIndex.get(b.id)!);

    return {
      items: detailed.map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category?.name ?? null,
        brand: p.brand,
        price: p.price,
        rating: p.rating,
        stock_quantity: p.stock_quantity,
        is_active: p.is_active,
        created_at: p.created_at,
        thumbnail: p.images?.[0]?.image_url ?? null,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // GET /api/admin/products/brands
  async findAllBrands(): Promise<string[]> {
    const rows = await this.productRepo
      .createQueryBuilder('product')
      .select('DISTINCT product.brand', 'brand')
      .where('product.brand IS NOT NULL')
      .andWhere("product.brand <> ''")
      .orderBy('product.brand', 'ASC')
      .getRawMany<{ brand: string }>();

    return rows.map((r) => r.brand);
  }

  // POST /api/admin/products
  async create(dto: CreateProductDto) {
    const product = this.productRepo.create({
      name: dto.name,
      category_id: dto.category_id ?? null,
      brand: dto.brand ?? null,
      price: dto.price,
      description: dto.description ?? null,
      stock_quantity: dto.stock_quantity ?? 0,
      is_active: dto.is_active ?? true,
    });
    const saved = await this.productRepo.save(product);

    return {
      id: saved.id,
      name: saved.name,
      category_id: saved.category_id,
      brand: saved.brand,
      price: saved.price,
      description: saved.description,
      stock_quantity: saved.stock_quantity,
      is_active: saved.is_active,
      created_at: saved.created_at,
    };
  }

  // PUT /api/admin/products/:id
  async update(id: string, dto: UpdateProductDto) {
    const product = await this.findProductOrFail(id);

    if (dto.name !== undefined) product.name = dto.name;
    if (dto.category_id !== undefined)
      product.category_id = dto.category_id || null;
    if (dto.brand !== undefined) product.brand = dto.brand.trim() || null;
    if (dto.price !== undefined) product.price = dto.price;
    if (dto.description !== undefined) product.description = dto.description;
    if (dto.stock_quantity !== undefined)
      product.stock_quantity = dto.stock_quantity;
    if (dto.is_active !== undefined) product.is_active = dto.is_active;
    const saved = await this.productRepo.save(product);

    return {
      id: saved.id,
      name: saved.name,
      category_id: saved.category_id,
      brand: saved.brand,
      price: saved.price,
      description: saved.description,
      stock_quantity: saved.stock_quantity,
      rating: saved.rating,
      is_active: saved.is_active,
      updated_at: saved.updated_at,
    };
  }

  async recalculateRating(productId: string): Promise<string | null> {
    const raw = await this.reviewRepo
      .createQueryBuilder('review')
      .select('AVG(review.rating)', 'avg')
      .where('review.product_id = :productId', { productId })
      .getRawOne<{ avg: string | null }>();

    const avg = raw?.avg;
    const rating =
      avg !== null && avg !== undefined ? Number(avg).toFixed(1) : null;
    await this.productRepo.update({ id: productId }, { rating });
    return rating;
  }

  // DELETE /api/admin/products/:id
  async remove(id: string) {
    const product = await this.productRepo.findOne({
      where: { id },
      relations: { images: true },
    });
    if (!product) throw productNotFound();

    // B14: song song thay cho tuần tự, tổng thời gian tối đa ~1 timeout thay vì n × timeout
    await Promise.all(
      (product.images ?? [])
        .filter((img) => img.public_id)
        .map((img) => this.cloudinaryService.deleteImage(img.public_id)),
    );

    await this.productRepo.remove(product);
    return { message: 'Đã xoá sản phẩm thành công' };
  }

  // POST /api/admin/products/:id/images
  async addImage(
    productId: string,
    file: Express.Multer.File | undefined,
    dto: CreateProductImageDto,
  ) {
    const imageUrl = dto.image_url?.trim();
    if (!file && !imageUrl) {
      throw new BusinessException(
        400,
        CAT_ERROR.IMAGE_REQUIRED,
        'Vui lòng chọn file ảnh hoặc nhập URL ảnh',
      );
    }
    await this.findProductOrFail(productId);

    let finalUrl: string;
    let publicId: string | null;

    if (file) {
      const uploadResult = await this.cloudinaryService.uploadImage(
        file,
        `products/${productId}`,
      );
      finalUrl = uploadResult.secure_url;
      publicId = uploadResult.public_id;
    } else {
      finalUrl = imageUrl!;
      publicId = null;
    }

    if (dto.is_primary) {
      await this.imageRepo.update(
        { product_id: productId },
        { is_primary: false },
      );
    }

    const image = this.imageRepo.create({
      product_id: productId,
      image_url: finalUrl,
      public_id: publicId,
      is_primary: dto.is_primary ?? false,
      sort_order: dto.sort_order ?? 0,
    });
    const saved = await this.imageRepo.save(image);

    return {
      id: saved.id,
      image_url: saved.image_url,
      is_primary: saved.is_primary,
      sort_order: saved.sort_order,
    };
  }

  // PUT /api/admin/products/:id/images/:image_id
  async updateImage(
    productId: string,
    imageId: string,
    file: Express.Multer.File | undefined,
    dto: UpdateProductImageDto,
  ) {
    const image = await this.imageRepo.findOne({
      where: { id: imageId, product_id: productId },
    });
    if (!image) throw new NotFoundException('Không tìm thấy ảnh sản phẩm');

    if (file) {
      const uploadResult = await this.cloudinaryService.uploadImage(
        file,
        `products/${productId}`,
      );
      if (image.public_id) {
        await this.cloudinaryService.deleteImage(image.public_id);
      }
      image.image_url = uploadResult.secure_url;
      image.public_id = uploadResult.public_id;
    }

    if (dto.is_primary !== undefined) {
      if (dto.is_primary) {
        await this.imageRepo.update(
          { product_id: productId },
          { is_primary: false },
        );
      }
      image.is_primary = dto.is_primary;
    }

    if (dto.sort_order !== undefined) {
      image.sort_order = dto.sort_order;
    }

    const saved = await this.imageRepo.save(image);

    return {
      id: saved.id,
      image_url: saved.image_url,
      is_primary: saved.is_primary,
      sort_order: saved.sort_order,
    };
  }

  // DELETE /api/admin/products/:id/images/:image_id
  async removeImage(productId: string, imageId: string) {
    const image = await this.imageRepo.findOne({
      where: { id: imageId, product_id: productId },
    });
    if (!image) throw new NotFoundException('Không tìm thấy ảnh sản phẩm');

    if (image.public_id) {
      await this.cloudinaryService.deleteImage(image.public_id);
    }
    await this.imageRepo.remove(image);

    if (image.is_primary) {
      const [next] = await this.imageRepo.find({
        where: { product_id: productId },
        order: { sort_order: 'ASC' },
        take: 1,
      });
      if (next) {
        next.is_primary = true;
        await this.imageRepo.save(next);
      }
    }

    return { message: 'Đã xoá ảnh sản phẩm' };
  }

  // POST /api/admin/products/:id/specs
  async addSpec(productId: string, dto: CreateProductSpecDto) {
    await this.findProductOrFail(productId);

    const spec = this.specRepo.create({
      product_id: productId,
      spec_key: dto.spec_key,
      spec_value: dto.spec_value,
      spec_unit: dto.spec_unit ?? null,
    });
    const saved = await this.specRepo.save(spec);

    return {
      id: saved.id,
      spec_key: saved.spec_key,
      spec_value: saved.spec_value,
      spec_unit: saved.spec_unit,
    };
  }

  // PUT /api/admin/products/:id/specs/:spec_id
  async updateSpec(
    productId: string,
    specId: string,
    dto: UpdateProductSpecDto,
  ) {
    const spec = await this.specRepo.findOne({
      where: { id: specId, product_id: productId },
    });
    if (!spec) throw new NotFoundException('Không tìm thấy thông số kỹ thuật');

    if (dto.spec_key !== undefined) spec.spec_key = dto.spec_key;
    if (dto.spec_value !== undefined) spec.spec_value = dto.spec_value;
    if (dto.spec_unit !== undefined) spec.spec_unit = dto.spec_unit;

    const saved = await this.specRepo.save(spec);

    return {
      id: saved.id,
      spec_key: saved.spec_key,
      spec_value: saved.spec_value,
      spec_unit: saved.spec_unit,
    };
  }

  // DELETE /api/admin/products/:id/specs/:spec_id
  async removeSpec(productId: string, specId: string) {
    const spec = await this.specRepo.findOne({
      where: { id: specId, product_id: productId },
    });
    if (!spec) throw new NotFoundException('Không tìm thấy thông số kỹ thuật');

    await this.specRepo.remove(spec);
    return { message: 'Đã xoá thông số kỹ thuật' };
  }

  // POST /api/admin/products/:id/tags
  async addTag(productId: string, dto: CreateProductTagDto) {
    // B18: be/ nạp sản phẩm kèm tags rồi save cả quan hệ (7 truy vấn khi tag mới, vượt ngưỡng ghi 6).
    // Ở đây: kiểm tồn tại, rồi chèn thẳng bảng nối; đã gắn thì PK (product_id, tag_id) bỏ qua như be/.
    const exists = await this.productRepo.exists({ where: { id: productId } });
    if (!exists) throw productNotFound();

    let tag = await this.tagRepo.findOne({ where: { name: dto.tag } });
    if (!tag) {
      tag = await this.tagRepo.save(this.tagRepo.create({ name: dto.tag }));
    }

    await this.productRepo
      .createQueryBuilder()
      .insert()
      .into('product_tag_map')
      .values({ product_id: productId, tag_id: tag.id })
      .orIgnore()
      .execute();

    return { id: tag.id, tag: tag.name };
  }

  // DELETE /api/admin/products/:id/tags/:tag_id
  async removeTag(productId: string, tagId: string) {
    const product = await this.productRepo.findOne({
      where: { id: productId },
      relations: { tags: true },
    });
    if (!product) throw productNotFound();

    const exists = product.tags?.some((t) => t.id === tagId);
    if (!exists) {
      throw new NotFoundException('Sản phẩm chưa gắn tag này');
    }

    product.tags = product.tags.filter((t) => t.id !== tagId);
    await this.productRepo.save(product);

    return { message: 'Đã gỡ tag khỏi sản phẩm' };
  }
}
