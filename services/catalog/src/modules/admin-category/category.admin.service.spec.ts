import { NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { Category } from '../../database/entities/category.entity';
import { Industry } from '../../database/entities/industry.entity';
import { AdminCategoryService } from './category.admin.service';

// Chép nguyên be/src/admin/category/category.admin.service.ts. 404 không có mã riêng → NT-GEN-0004 qua filter.

async function expectNotFound(call: Promise<unknown>, message: string) {
  const err = (await call.catch((e: unknown) => e)) as NotFoundException;
  expect(err).toBeInstanceOf(NotFoundException);
  expect(err.message).toBe(message);
}

describe('AdminCategoryService', () => {
  let categoryRepo: Record<string, jest.Mock>;
  let industryRepo: { findOne: jest.Mock };
  let service: AdminCategoryService;

  beforeEach(() => {
    categoryRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((x: object) => x),
      save: jest.fn((x: object) => Promise.resolve(x)),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    industryRepo = { findOne: jest.fn().mockResolvedValue(null) };
    service = new AdminCategoryService(
      categoryRepo as unknown as Repository<Category>,
      industryRepo as unknown as Repository<Industry>,
    );
  });

  it.each([
    ['findOneOrFail', (s: AdminCategoryService) => s.findOneOrFail('c1')],
    ['update', (s: AdminCategoryService) => s.update('c1', {})],
    ['remove', (s: AdminCategoryService) => s.remove('c1')],
    ['hardRemove', (s: AdminCategoryService) => s.hardRemove('c1')],
  ])('%s: không có → 404 "Không tìm thấy danh mục"', async (_, call) => {
    await expectNotFound(call(service), 'Không tìm thấy danh mục');
  });

  it('tạo với ngành không tồn tại → 404 "Không tìm thấy ngành học", không lưu', async () => {
    await expectNotFound(
      service.create({ name: 'Tai nghe', industryId: 'i9' }),
      'Không tìm thấy ngành học',
    );
    expect(categoryRepo.save).not.toHaveBeenCalled();
  });

  it('tạo: giá trị mặc định như be/', async () => {
    await service.create({ name: 'Tai nghe' });
    expect(categoryRepo.save).toHaveBeenCalledWith({
      name: 'Tai nghe',
      icon: null,
      sortOrder: 0,
      isActive: true,
      industry_id: null,
    });
  });

  it('đổi ngành: gán cả relation để TypeORM không ghi đè industry_id cũ', async () => {
    const industry = { id: 'i2' };
    categoryRepo.findOne.mockResolvedValue({
      id: 'c1',
      industry_id: 'i1',
      industry: { id: 'i1' },
    });
    industryRepo.findOne.mockResolvedValue(industry);

    await service.update('c1', { industryId: 'i2' });

    expect(categoryRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ industry_id: 'i2', industry }),
    );
  });

  it('xoá mềm: chỉ ẩn danh mục', async () => {
    categoryRepo.findOne.mockResolvedValue({ id: 'c1', isActive: true });

    await expect(service.remove('c1')).resolves.toEqual({
      message: 'Đã ẩn danh mục thành công',
    });
    expect(categoryRepo.save).toHaveBeenCalledWith({
      id: 'c1',
      isActive: false,
    });
    expect(categoryRepo.remove).not.toHaveBeenCalled();
  });
});
