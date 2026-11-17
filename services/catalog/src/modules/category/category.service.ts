// Chép nguyên từ be/src/users/category/category.service.ts (chỉ đổi đường dẫn entity)
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Category } from '../../database/entities/category.entity';
import { Product } from '../../database/entities/product.entity';
import { CategoryProductsQueryDto } from './category.dto';

@Injectable()
export class CategoryService {
  constructor(
    @InjectRepository(Category)
    private readonly categoryRepo: Repository<Category>,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
  ) {}

  // Danh sách danh mục đang hoạt động
  findAllActive(): Promise<Category[]> {
    return this.categoryRepo.find({
      where: { isActive: true },
      order: { sortOrder: 'ASC' },
    });
  }

  // Chi tiết 1 danh mục đang hoạt động, kèm danh sách sản phẩm
  async findOneActive(id: string, query: CategoryProductsQueryDto) {
    const category = await this.categoryRepo.findOne({
      where: { id, isActive: true },
    });
    if (!category) throw new NotFoundException('Không tìm thấy danh mục');

    const { page = 1, limit = 20 } = query;

    const [items, total] = await this.productRepo.findAndCount({
      where: { category_id: id, is_active: true },
      order: { created_at: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      ...category,
      products: {
        items,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
