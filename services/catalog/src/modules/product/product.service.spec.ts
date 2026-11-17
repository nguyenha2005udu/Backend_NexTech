import { BusinessException, UpstreamError } from '@nextech/service-kit';
import type { Repository } from 'typeorm';
import { Product } from '../../database/entities/product.entity';
import { ProductReview } from '../../database/entities/product-review.entity';
import { ProductService } from './product.service';

// Hành vi giữ nguyên be/src/users/product/product.service.ts. Đổi do tách service:
// - "Không tìm thấy sản phẩm" có mã NT-CAT-1005 (API_Spec §4), giữ câu chữ.
// - findReviews đọc snapshot user_name/user_avatar_url thay cho JOIN users (Component_Class_Design §2).
// - createReview tạm trả 503 tới T2.5 (cần order-service để kiểm BR-11).

async function expectProductNotFound(call: Promise<unknown>) {
  const err = (await call.catch((e: unknown) => e)) as BusinessException;
  expect(err).toBeInstanceOf(BusinessException);
  expect(err.getStatus()).toBe(404);
  expect(err.code).toBe('NT-CAT-1005');
  expect(err.getResponse()).toMatchObject({
    message: 'Không tìm thấy sản phẩm',
  });
}

describe('ProductService', () => {
  let productRepo: { findOne: jest.Mock; createQueryBuilder: jest.Mock };
  let reviewRepo: { count: jest.Mock; findAndCount: jest.Mock };
  let service: ProductService;

  beforeEach(() => {
    productRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      createQueryBuilder: jest.fn(),
    };
    reviewRepo = {
      count: jest.fn().mockResolvedValue(0),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    service = new ProductService(
      productRepo as unknown as Repository<Product>,
      reviewRepo as unknown as Repository<ProductReview>,
    );
  });

  describe('findOne', () => {
    it('không có hoặc đã tắt → 404 NT-CAT-1005', async () => {
      await expectProductNotFound(service.findOne('p1'));
      expect(productRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'p1', is_active: true },
        relations: { category: true, images: true, specs: true, tags: true },
      });
      expect(reviewRepo.count).not.toHaveBeenCalled();
    });

    it('có → kèm review_count', async () => {
      productRepo.findOne.mockResolvedValue({ id: 'p1', name: 'A' });
      reviewRepo.count.mockResolvedValue(3);
      await expect(service.findOne('p1')).resolves.toEqual({
        id: 'p1',
        name: 'A',
        review_count: 3,
      });
    });
  });

  describe('findSpecs', () => {
    it('không có → 404 NT-CAT-1005', async () => {
      await expectProductNotFound(service.findSpecs('p1'));
    });

    it('chỉ trả key, value, unit', async () => {
      productRepo.findOne.mockResolvedValue({
        specs: [
          {
            id: 's1',
            product_id: 'p1',
            spec_key: 'ram',
            spec_value: '16',
            spec_unit: 'GB',
          },
        ],
      });
      await expect(service.findSpecs('p1')).resolves.toEqual([
        { spec_key: 'ram', spec_value: '16', spec_unit: 'GB' },
      ]);
    });
  });

  describe('findReviews', () => {
    it('đọc snapshot, không JOIN users; thiếu tên → "Ẩn danh"', async () => {
      const at = new Date('2026-11-01T00:00:00Z');
      reviewRepo.findAndCount.mockResolvedValue([
        [
          {
            id: 'r1',
            user_name: 'An',
            user_avatar_url: 'https://a',
            rating: '5.0',
            title: 't',
            content: 'c',
            created_at: at,
          },
          {
            id: 'r2',
            user_name: null,
            user_avatar_url: null,
            rating: '4.0',
            title: null,
            content: null,
            created_at: at,
          },
        ],
        2,
      ]);

      const res = await service.findReviews('p1', { page: 2, limit: 1 });

      expect(reviewRepo.findAndCount).toHaveBeenCalledWith({
        where: { product_id: 'p1' },
        order: { created_at: 'DESC' },
        skip: 1,
        take: 1,
      });
      expect(res).toEqual({
        items: [
          {
            id: 'r1',
            user_name: 'An',
            avatar_url: 'https://a',
            rating: '5.0',
            title: 't',
            content: 'c',
            created_at: at,
          },
          {
            id: 'r2',
            user_name: 'Ẩn danh',
            avatar_url: null,
            rating: '4.0',
            title: null,
            content: null,
            created_at: at,
          },
        ],
        total: 2,
        page: 2,
        limit: 1,
        totalPages: 2,
      });
    });
  });

  describe('createReview (tạm, tới T2.5)', () => {
    it('503 NT-GEN-0503, không chạm DB', async () => {
      const err = (await service
        .createReview('p1', 'u1', { rating: 5 })
        .catch((e: unknown) => e)) as UpstreamError;
      expect(err).toBeInstanceOf(UpstreamError);
      expect(err.getStatus()).toBe(503);
      expect(err.code).toBe('NT-GEN-0503');
      expect(productRepo.findOne).not.toHaveBeenCalled();
    });
  });
});
