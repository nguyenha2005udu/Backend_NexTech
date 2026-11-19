import { BusinessException } from '@nextech/service-kit';
import { In, QueryFailedError, type Repository } from 'typeorm';
import { PriceAlert } from '../../database/entities/price-alert.entity';
import { Product } from '../../database/entities/product.entity';
import { ProductImage } from '../../database/entities/product-image.entity';
import { PriceAlertService } from './price-alert.service';

// Hành vi giữ be/src/users/pricealert/pricealert.service.ts. Đổi do tách service: mã lỗi NT-CAT-1005,
// 1008, 1009 (API_Spec §4); trùng đồng thời bắt bằng unique index (B1). Cron: test Postgres thật.
const errOf = async (call: Promise<unknown>) =>
  (await call.catch((e: unknown) => e)) as BusinessException;

describe('PriceAlertService', () => {
  let alertRepo: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let productRepo: { findOne: jest.Mock };
  let imageRepo: { find: jest.Mock };
  let service: PriceAlertService;

  beforeEach(() => {
    alertRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((v: object) => ({ ...v })),
      save: jest.fn((v: object) => Promise.resolve({ id: 'a1', ...v })),
    };
    productRepo = { findOne: jest.fn().mockResolvedValue({ id: 'p1' }) };
    imageRepo = { find: jest.fn().mockResolvedValue([]) };
    service = new PriceAlertService(
      alertRepo as unknown as Repository<PriceAlert>,
      productRepo as unknown as Repository<Product>,
      imageRepo as unknown as Repository<ProductImage>,
    );
  });

  describe('findMine', () => {
    it('trả mảng theo shape be/, ảnh chính lấy một lần cho mọi sản phẩm', async () => {
      const created = new Date('2026-11-19T00:00:00Z');
      alertRepo.find.mockResolvedValue([
        {
          id: 'a1',
          product_id: 'p1',
          product: { id: 'p1', name: 'Tai nghe', price: '200000' },
          target_price: '150000',
          status: 'active',
          notify_channel: 'app',
          created_at: created,
        },
        {
          id: 'a2',
          product_id: 'p2',
          product: { id: 'p2', name: 'Loa', price: '500000' },
          target_price: '400000',
          status: 'cancelled',
          notify_channel: 'email',
          created_at: created,
        },
      ]);
      imageRepo.find.mockResolvedValue([
        { product_id: 'p1', image_url: 'https://img/p1.jpg' },
      ]);

      const res = await service.findMine('u1');

      expect(alertRepo.find).toHaveBeenCalledWith({
        where: { user_id: 'u1' },
        relations: { product: true },
        order: { created_at: 'DESC' },
      });
      expect(imageRepo.find).toHaveBeenCalledTimes(1);
      expect(imageRepo.find).toHaveBeenCalledWith({
        where: { product_id: In(['p1', 'p2']), is_primary: true },
      });
      expect(res).toEqual([
        {
          id: 'a1',
          product: {
            id: 'p1',
            name: 'Tai nghe',
            price: '200000',
            image: 'https://img/p1.jpg',
          },
          target_price: '150000',
          status: 'active',
          notify_channel: 'app',
          created_at: created,
        },
        {
          id: 'a2',
          product: { id: 'p2', name: 'Loa', price: '500000', image: null },
          target_price: '400000',
          status: 'cancelled',
          notify_channel: 'email',
          created_at: created,
        },
      ]);
    });

    it('không có theo dõi nào → [], không truy vấn ảnh', async () => {
      await expect(service.findMine('u1')).resolves.toEqual([]);
      expect(imageRepo.find).not.toHaveBeenCalled();
    });
  });

  describe('create (BR-12)', () => {
    const dto = { product_id: 'p1', target_price: 150000 };

    it('sản phẩm không có → 404 NT-CAT-1005, câu chữ be/', async () => {
      productRepo.findOne.mockResolvedValue(null);

      const err = await errOf(service.create('u1', dto));

      expect(err.getStatus()).toBe(404);
      expect(err.code).toBe('NT-CAT-1005');
      expect(err.getResponse()).toMatchObject({
        message: 'Không tìm thấy sản phẩm',
      });
      expect(alertRepo.save).not.toHaveBeenCalled();
    });

    it('đang theo dõi (active) → 409 NT-CAT-1008', async () => {
      alertRepo.findOne.mockResolvedValue({ id: 'a0' });

      const err = await errOf(service.create('u1', dto));

      expect(alertRepo.findOne).toHaveBeenCalledWith({
        where: { user_id: 'u1', product_id: 'p1', status: 'active' },
      });
      expect(err.getStatus()).toBe(409);
      expect(err.code).toBe('NT-CAT-1008');
      expect(err.getResponse()).toMatchObject({
        message: 'Bạn đang theo dõi giá sản phẩm này rồi',
      });
    });

    it('tạo mới: notify_channel mặc định app, trả shape be/', async () => {
      const res = await service.create('u1', dto);

      expect(alertRepo.save).toHaveBeenCalledWith({
        user_id: 'u1',
        product_id: 'p1',
        target_price: 150000,
        notify_channel: 'app',
        status: 'active',
      });
      expect(res).toEqual({
        id: 'a1',
        product_id: 'p1',
        target_price: 150000,
        status: 'active',
        notify_channel: 'app',
      });
    });

    it('hai request cùng lúc vượt kiểm tra đọc → unique index → 409 NT-CAT-1008', async () => {
      alertRepo.save.mockRejectedValue(
        new QueryFailedError(
          'INSERT',
          [],
          Object.assign(new Error('dup'), {
            code: '23505',
            constraint: 'ux_alerts_user_product_active',
          }),
        ),
      );

      const err = await errOf(service.create('u1', dto));

      expect(err).toBeInstanceOf(BusinessException);
      expect(err.code).toBe('NT-CAT-1008');
    });
  });

  describe('remove', () => {
    it('không có hoặc của người khác → 404 NT-CAT-1009', async () => {
      const err = await errOf(service.remove('u1', 'a1'));

      expect(alertRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'a1', user_id: 'u1' },
      });
      expect(err.getStatus()).toBe(404);
      expect(err.code).toBe('NT-CAT-1009');
      expect(err.getResponse()).toMatchObject({
        message: 'Không tìm thấy theo dõi giá',
      });
    });

    it('có → đổi cancelled, trả message be/', async () => {
      alertRepo.findOne.mockResolvedValue({ id: 'a1', status: 'active' });

      await expect(service.remove('u1', 'a1')).resolves.toEqual({
        message: 'Đã huỷ theo dõi giá',
      });
      expect(alertRepo.save).toHaveBeenCalledWith({
        id: 'a1',
        status: 'cancelled',
      });
    });
  });
});
