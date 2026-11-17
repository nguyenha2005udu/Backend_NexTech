import { NotFoundException } from '@nestjs/common';
import { BusinessException } from '@nextech/service-kit';
import type { Repository } from 'typeorm';
import type { CloudinaryService } from '../../cloudinary/cloudinary.service';
import { Product } from '../../database/entities/product.entity';
import { ProductImage } from '../../database/entities/product-image.entity';
import { ProductReview } from '../../database/entities/product-review.entity';
import { ProductSpec } from '../../database/entities/product-spec.entity';
import { Tag } from '../../database/entities/tag.entity';
import { AdminProductService } from './product.admin.service';

// Hành vi giữ nguyên be/src/admin/product/product.admin.service.ts. Đổi do tách service:
// - "Không tìm thấy sản phẩm" → 404 NT-CAT-1005; thiếu ảnh → 400 NT-CAT-1010 (API_Spec §4), giữ câu chữ.
// - remove xoá ảnh Cloudinary song song (quyết định B14, Processing_Flow §6).

async function expectBusiness(
  call: Promise<unknown>,
  status: number,
  code: string,
  message: string,
) {
  const err = (await call.catch((e: unknown) => e)) as BusinessException;
  expect(err).toBeInstanceOf(BusinessException);
  expect(err.getStatus()).toBe(status);
  expect(err.code).toBe(code);
  expect(err.getResponse()).toMatchObject({ message });
}

describe('AdminProductService', () => {
  let productRepo: Record<string, jest.Mock>;
  let imageRepo: Record<string, jest.Mock>;
  let specRepo: Record<string, jest.Mock>;
  let tagRepo: Record<string, jest.Mock>;
  let reviewRepo: Record<string, jest.Mock>;
  let cloudinary: { uploadImage: jest.Mock; deleteImage: jest.Mock };
  let service: AdminProductService;

  const repo = () => ({
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
    create: jest.fn((x: object) => x),
    save: jest.fn((x: object) => Promise.resolve({ id: 'new', ...x })),
    update: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
    exists: jest.fn().mockResolvedValue(false),
    createQueryBuilder: jest.fn(),
  });

  /** QueryBuilder giả cho lệnh chèn bảng nối */
  const insertQb = () => {
    const qb: Record<string, jest.Mock> = {};
    for (const m of ['insert', 'into', 'values', 'orIgnore']) {
      qb[m] = jest.fn(() => qb);
    }
    qb.execute = jest.fn().mockResolvedValue({ raw: [] });
    return qb;
  };

  beforeEach(() => {
    productRepo = repo();
    imageRepo = repo();
    specRepo = repo();
    tagRepo = repo();
    reviewRepo = repo();
    cloudinary = {
      uploadImage: jest.fn(),
      deleteImage: jest.fn().mockResolvedValue(undefined),
    };
    service = new AdminProductService(
      productRepo as unknown as Repository<Product>,
      imageRepo as unknown as Repository<ProductImage>,
      specRepo as unknown as Repository<ProductSpec>,
      tagRepo as unknown as Repository<Tag>,
      reviewRepo as unknown as Repository<ProductReview>,
      cloudinary as unknown as CloudinaryService,
    );
  });

  it.each([
    ['update', (s: AdminProductService) => s.update('p1', {})],
    ['remove', (s: AdminProductService) => s.remove('p1')],
    [
      'addImage',
      (s: AdminProductService) =>
        s.addImage('p1', undefined, { image_url: 'https://x' }),
    ],
    [
      'addSpec',
      (s: AdminProductService) =>
        s.addSpec('p1', { spec_key: 'k', spec_value: 'v' }),
    ],
    ['addTag', (s: AdminProductService) => s.addTag('p1', { tag: 't' })],
    ['removeTag', (s: AdminProductService) => s.removeTag('p1', 't1')],
  ])('%s: không có sản phẩm → 404 NT-CAT-1005', async (_, call) => {
    await expectBusiness(
      call(service),
      404,
      'NT-CAT-1005',
      'Không tìm thấy sản phẩm',
    );
  });

  describe('addImage', () => {
    it.each([undefined, '', '   '])(
      'không file, URL %p → 400 NT-CAT-1010, chưa chạm DB',
      async (image_url) => {
        await expectBusiness(
          service.addImage('p1', undefined, { image_url }),
          400,
          'NT-CAT-1010',
          'Vui lòng chọn file ảnh hoặc nhập URL ảnh',
        );
        expect(productRepo.findOne).not.toHaveBeenCalled();
      },
    );

    it('bằng URL → không gọi Cloudinary, public_id null; ảnh chính thì bỏ ảnh chính cũ', async () => {
      productRepo.findOne.mockResolvedValue({ id: 'p1' });

      const res = await service.addImage('p1', undefined, {
        image_url: ' https://x/a.jpg ',
        is_primary: true,
        sort_order: 2,
      });

      expect(cloudinary.uploadImage).not.toHaveBeenCalled();
      expect(imageRepo.update).toHaveBeenCalledWith(
        { product_id: 'p1' },
        { is_primary: false },
      );
      expect(imageRepo.save).toHaveBeenCalledWith({
        product_id: 'p1',
        image_url: 'https://x/a.jpg',
        public_id: null,
        is_primary: true,
        sort_order: 2,
      });
      expect(res).toEqual({
        id: 'new',
        image_url: 'https://x/a.jpg',
        is_primary: true,
        sort_order: 2,
      });
    });

    it('bằng file → upload vào products/<id>, lưu secure_url và public_id', async () => {
      productRepo.findOne.mockResolvedValue({ id: 'p1' });
      cloudinary.uploadImage.mockResolvedValue({
        secure_url: 'https://c/1',
        public_id: 'products/p1/1',
      });
      const file = { buffer: Buffer.from('x') } as Express.Multer.File;

      await service.addImage('p1', file, {});

      expect(cloudinary.uploadImage).toHaveBeenCalledWith(file, 'products/p1');
      expect(imageRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          image_url: 'https://c/1',
          public_id: 'products/p1/1',
        }),
      );
    });
  });

  describe('remove', () => {
    it('xoá ảnh Cloudinary song song (B14), bỏ ảnh URL, rồi xoá sản phẩm', async () => {
      const product = {
        id: 'p1',
        images: [{ public_id: 'a' }, { public_id: null }, { public_id: 'b' }],
      };
      productRepo.findOne.mockResolvedValue(product);
      const pending: Array<() => void> = [];
      cloudinary.deleteImage.mockImplementation(
        () => new Promise<void>((resolve) => pending.push(resolve)),
      );

      const done = service.remove('p1');
      await new Promise((r) => setImmediate(r));

      // Cả hai lời gọi đã bắt đầu trước khi lời gọi nào xong → song song
      expect(cloudinary.deleteImage.mock.calls).toEqual([['a'], ['b']]);
      expect(productRepo.remove).not.toHaveBeenCalled();

      pending.forEach((resolve) => resolve());
      await expect(done).resolves.toEqual({
        message: 'Đã xoá sản phẩm thành công',
      });
      expect(productRepo.remove).toHaveBeenCalledWith(product);
    });
  });

  describe('removeImage', () => {
    it('không có ảnh của sản phẩm → 404 "Không tìm thấy ảnh sản phẩm"', async () => {
      const err = (await service
        .removeImage('p1', 'i1')
        .catch((e: unknown) => e)) as NotFoundException;
      expect(err).toBeInstanceOf(NotFoundException);
      expect(err.message).toBe('Không tìm thấy ảnh sản phẩm');
    });

    it('xoá ảnh chính → ảnh sort_order nhỏ nhất thành ảnh chính', async () => {
      imageRepo.findOne.mockResolvedValue({
        id: 'i1',
        public_id: null,
        is_primary: true,
      });
      const next = { id: 'i2', is_primary: false };
      imageRepo.find.mockResolvedValue([next]);

      await service.removeImage('p1', 'i1');

      expect(cloudinary.deleteImage).not.toHaveBeenCalled();
      expect(imageRepo.find).toHaveBeenCalledWith({
        where: { product_id: 'p1' },
        order: { sort_order: 'ASC' },
        take: 1,
      });
      expect(imageRepo.save).toHaveBeenCalledWith({
        id: 'i2',
        is_primary: true,
      });
    });
  });

  describe('addTag', () => {
    it('B18: kiểm sản phẩm bằng exists, tag mới được tạo, liên kết bằng INSERT ... ON CONFLICT DO NOTHING', async () => {
      productRepo.exists.mockResolvedValue(true);
      const qb = insertQb();
      productRepo.createQueryBuilder.mockReturnValue(qb);

      const res = await service.addTag('p1', { tag: 't' });

      expect(productRepo.exists).toHaveBeenCalledWith({ where: { id: 'p1' } });
      expect(productRepo.findOne).not.toHaveBeenCalled();
      expect(productRepo.save).not.toHaveBeenCalled();
      expect(tagRepo.save).toHaveBeenCalledWith({ name: 't' });
      expect(qb.into).toHaveBeenCalledWith('product_tag_map');
      expect(qb.values).toHaveBeenCalledWith({
        product_id: 'p1',
        tag_id: 'new',
      });
      expect(qb.orIgnore).toHaveBeenCalled();
      expect(qb.execute).toHaveBeenCalledTimes(1);
      expect(res).toEqual({ id: 'new', tag: 't' });
    });

    it('tag đã có → dùng lại, không tạo tag mới; gắn lần hai không lỗi (orIgnore)', async () => {
      productRepo.exists.mockResolvedValue(true);
      tagRepo.findOne.mockResolvedValue({ id: 't9', name: 't' });
      const qb = insertQb();
      productRepo.createQueryBuilder.mockReturnValue(qb);

      const res = await service.addTag('p1', { tag: 't' });

      expect(tagRepo.findOne).toHaveBeenCalledWith({ where: { name: 't' } });
      expect(tagRepo.save).not.toHaveBeenCalled();
      expect(qb.values).toHaveBeenCalledWith({
        product_id: 'p1',
        tag_id: 't9',
      });
      expect(res).toEqual({ id: 't9', tag: 't' });
    });
  });

  describe('removeTag', () => {
    it('sản phẩm chưa gắn tag → 404 "Sản phẩm chưa gắn tag này"', async () => {
      productRepo.findOne.mockResolvedValue({ id: 'p1', tags: [{ id: 't2' }] });
      const err = (await service
        .removeTag('p1', 't1')
        .catch((e: unknown) => e)) as NotFoundException;
      expect(err).toBeInstanceOf(NotFoundException);
      expect(err.message).toBe('Sản phẩm chưa gắn tag này');
    });
  });
});
