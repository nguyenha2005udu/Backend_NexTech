import { BusinessException, UpstreamError } from '@nextech/service-kit';
import { QueryFailedError, type Repository } from 'typeorm';
import type { IdentityClient } from '../../clients/identity.client';
import type { OrderClient } from '../../clients/order.client';
import { Product } from '../../database/entities/product.entity';
import { ProductReview } from '../../database/entities/product-review.entity';
import { ProductService } from './product.service';

// Hành vi giữ nguyên be/src/users/product/product.service.ts. Đổi do tách service:
// - "Không tìm thấy sản phẩm" có mã NT-CAT-1005 (API_Spec §4), giữ câu chữ.
// - findReviews đọc snapshot user_name/user_avatar_url thay cho JOIN users (Component_Class_Design §2).
// - createReview: hỏi order đã mua chưa (BR-11), lưu snapshot tên từ identity (Processing_Flow §3, T2.5).

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
  let reviewRepo: {
    count: jest.Mock;
    findAndCount: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let orders: { hasPurchased: jest.Mock };
  let identity: { getUserSnapshot: jest.Mock };
  let service: ProductService;

  beforeEach(() => {
    productRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      createQueryBuilder: jest.fn(),
    };
    reviewRepo = {
      count: jest.fn().mockResolvedValue(0),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((v: object) => ({ ...v })),
      save: jest.fn((v: object) => Promise.resolve({ id: 'r1', ...v })),
    };
    orders = { hasPurchased: jest.fn().mockResolvedValue(true) };
    identity = {
      getUserSnapshot: jest.fn().mockResolvedValue({
        full_name: 'Nguyễn A',
        avatar_url: 'https://a.jpg',
      }),
    };
    service = new ProductService(
      productRepo as unknown as Repository<Product>,
      reviewRepo as unknown as Repository<ProductReview>,
      orders as unknown as OrderClient,
      identity as unknown as IdentityClient,
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

  // BR-11, NT.CATALOG Processing_Flow §3 + API_Spec §3 (v1.6). Thứ tự và câu chữ giữ be/ createReview.
  describe('createReview', () => {
    const dto = { rating: 5, title: 'Tốt', content: 'Dùng ổn' };
    const errOf = async (call: Promise<unknown>) =>
      (await call.catch((e: unknown) => e)) as BusinessException;
    beforeEach(() => {
      productRepo.findOne.mockResolvedValue({ id: 'p1', name: 'A' });
    });

    it('sản phẩm không có → 404 NT-CAT-1005, không gọi order (be/: không lọc is_active)', async () => {
      productRepo.findOne.mockResolvedValue(null);
      await expectProductNotFound(service.createReview('p1', 'u1', dto));
      expect(productRepo.findOne).toHaveBeenCalledWith({ where: { id: 'p1' } });
      expect(orders.hasPurchased).not.toHaveBeenCalled();
    });

    it('chưa mua → 403 NT-CAT-1006, không ghi (BR-11)', async () => {
      orders.hasPurchased.mockResolvedValue(false);

      const err = await errOf(service.createReview('p1', 'u1', dto));

      expect(orders.hasPurchased).toHaveBeenCalledWith('u1', 'p1');
      expect(err.getStatus()).toBe(403);
      expect(err.code).toBe('NT-CAT-1006');
      expect(err.getResponse()).toMatchObject({
        message:
          'Bạn cần mua sản phẩm này (đơn hàng đã hoàn tất) trước khi đánh giá',
      });
      expect(reviewRepo.save).not.toHaveBeenCalled();
    });

    it('order chết → 503, không ghi, không gọi identity', async () => {
      orders.hasPurchased.mockRejectedValue(
        new UpstreamError('order', 'ECONNREFUSED', 'not_executed'),
      );

      const err = (await errOf(
        service.createReview('p1', 'u1', dto),
      )) as unknown as UpstreamError;

      expect(err).toBeInstanceOf(UpstreamError);
      expect(err.getStatus()).toBe(503);
      expect(identity.getUserSnapshot).not.toHaveBeenCalled();
      expect(reviewRepo.save).not.toHaveBeenCalled();
    });

    it('đã đánh giá → 403 NT-CAT-1007, không gọi identity (BR-11)', async () => {
      reviewRepo.findOne.mockResolvedValue({ id: 'r0' });

      const err = await errOf(service.createReview('p1', 'u1', dto));

      expect(reviewRepo.findOne).toHaveBeenCalledWith({
        where: { product_id: 'p1', user_id: 'u1' },
      });
      expect(err.getStatus()).toBe(403);
      expect(err.code).toBe('NT-CAT-1007');
      expect(err.getResponse()).toMatchObject({
        message: 'Bạn đã đánh giá sản phẩm này rồi',
      });
      expect(identity.getUserSnapshot).not.toHaveBeenCalled();
    });

    it('đủ điều kiện → lưu kèm snapshot tên, ảnh; trả đánh giá đã lưu', async () => {
      const res = await service.createReview('p1', 'u1', dto);

      expect(identity.getUserSnapshot).toHaveBeenCalledWith('u1');
      expect(reviewRepo.save).toHaveBeenCalledWith({
        product_id: 'p1',
        user_id: 'u1',
        user_name: 'Nguyễn A',
        user_avatar_url: 'https://a.jpg',
        rating: '5',
        title: 'Tốt',
        content: 'Dùng ổn',
      });
      expect(res).toMatchObject({ id: 'r1', user_name: 'Nguyễn A' });
    });

    it('identity chết → vẫn tạo, user_name và ảnh rỗng', async () => {
      identity.getUserSnapshot.mockResolvedValue(null);

      await service.createReview('p1', 'u1', { rating: 4 });

      expect(reviewRepo.save).toHaveBeenCalledWith({
        product_id: 'p1',
        user_id: 'u1',
        user_name: null,
        user_avatar_url: null,
        rating: '4',
        title: null,
        content: null,
      });
    });

    it('hai request cùng lúc vượt kiểm tra đọc → unique index → 403 NT-CAT-1007', async () => {
      reviewRepo.save.mockRejectedValue(
        new QueryFailedError(
          'INSERT',
          [],
          Object.assign(new Error('dup'), {
            code: '23505',
            constraint: 'ux_reviews_user_product',
          }),
        ),
      );

      const err = await errOf(service.createReview('p1', 'u1', dto));

      expect(err).toBeInstanceOf(BusinessException);
      expect(err.code).toBe('NT-CAT-1007');
    });

    it('lỗi DB khác → ném nguyên', async () => {
      const boom = new Error('db down');
      reviewRepo.save.mockRejectedValue(boom);
      await expect(service.createReview('p1', 'u1', dto)).rejects.toBe(boom);
    });
  });
});
