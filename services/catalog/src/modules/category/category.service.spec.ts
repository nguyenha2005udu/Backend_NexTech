import { NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { Category } from '../../database/entities/category.entity';
import { Product } from '../../database/entities/product.entity';
import { CategoryService } from './category.service';

// Chép nguyên be/src/users/category/category.service.ts. "Không tìm thấy danh mục" không có mã riêng trong
// API_Spec §4 → giữ NotFoundException, AllExceptionsFilter gắn NT-GEN-0004.

describe('CategoryService', () => {
  let categoryRepo: { find: jest.Mock; findOne: jest.Mock };
  let productRepo: { findAndCount: jest.Mock };
  let service: CategoryService;

  beforeEach(() => {
    categoryRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
    };
    productRepo = { findAndCount: jest.fn().mockResolvedValue([[], 0]) };
    service = new CategoryService(
      categoryRepo as unknown as Repository<Category>,
      productRepo as unknown as Repository<Product>,
    );
  });

  it('danh sách: chỉ danh mục đang bật, theo sort_order', async () => {
    await service.findAllActive();
    expect(categoryRepo.find).toHaveBeenCalledWith({
      where: { isActive: true },
      order: { sortOrder: 'ASC' },
    });
  });

  it('chi tiết: không có hoặc đã ẩn → 404 "Không tìm thấy danh mục"', async () => {
    const err = (await service
      .findOneActive('c1', {})
      .catch((e: unknown) => e)) as NotFoundException;
    expect(err).toBeInstanceOf(NotFoundException);
    expect(err.message).toBe('Không tìm thấy danh mục');
    expect(productRepo.findAndCount).not.toHaveBeenCalled();
  });

  it('chi tiết: kèm sản phẩm đang bán, phân trang', async () => {
    categoryRepo.findOne.mockResolvedValue({ id: 'c1', name: 'Tai nghe' });
    productRepo.findAndCount.mockResolvedValue([[{ id: 'p1' }], 21]);

    const res = await service.findOneActive('c1', { page: 2, limit: 20 });

    expect(productRepo.findAndCount).toHaveBeenCalledWith({
      where: { category_id: 'c1', is_active: true },
      order: { created_at: 'DESC' },
      skip: 20,
      take: 20,
    });
    expect(res).toEqual({
      id: 'c1',
      name: 'Tai nghe',
      products: {
        items: [{ id: 'p1' }],
        total: 21,
        page: 2,
        limit: 20,
        totalPages: 2,
      },
    });
  });
});
