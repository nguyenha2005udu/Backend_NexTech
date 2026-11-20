import { BusinessException, UpstreamError } from '@nextech/service-kit';
import type { Repository } from 'typeorm';
import type {
  CatalogClient,
  CatalogProduct,
} from '../../clients/catalog.client';
import type { Cart } from '../../database/entities/cart.entity';
import type { CartItem } from '../../database/entities/cart-item.entity';
import { CartService } from './cart.service';

// Hành vi giữ nguyên be/src/users/cart/cart.service.ts, chỉ đổi phần do tách service
// (NT.ORDER API_Spec §1 route 1–4, Processing_Flow §1–2, Component_Class_Design §7).
// Tạo giỏ đồng thời và số truy vấn: cart.service.int-spec.ts (Postgres thật).

const CART: Cart = { id: 'c1', user_id: 'u1' } as Cart;

const product = (over: Partial<CatalogProduct> = {}): CatalogProduct => ({
  id: 'p1',
  name: 'Tai nghe X',
  price: 1500000,
  stock_quantity: 5,
  is_active: true,
  image: 'https://img/p1.jpg',
  ...over,
});

const item = (over: Partial<CartItem> = {}): CartItem =>
  ({
    id: 'i1',
    cart_id: 'c1',
    product_id: 'p1',
    quantity: 2,
    added_at: new Date('2026-11-20T00:00:00Z'),
    updated_at: new Date('2026-11-20T00:00:00Z'),
    ...over,
  }) as CartItem;

const codeOf = async (p: Promise<unknown>) => {
  const err = await p.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(BusinessException);
  return {
    code: (err as BusinessException).code,
    status: (err as BusinessException).getStatus(),
    message: (err as BusinessException).message,
  };
};

describe('CartService', () => {
  const cartRepo = { findOne: jest.fn() };
  const itemRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn((x: Partial<CartItem>) => x),
    save: jest.fn(),
    remove: jest.fn(),
  };
  const catalog = { getProducts: jest.fn() };
  const service = new CartService(
    cartRepo as unknown as Repository<Cart>,
    itemRepo as unknown as Repository<CartItem>,
    catalog as unknown as CatalogClient,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    cartRepo.findOne.mockResolvedValue(CART);
    itemRepo.save.mockImplementation((x: Partial<CartItem>) =>
      Promise.resolve({
        id: 'i-new',
        added_at: new Date('2026-11-20T01:00:00Z'),
        updated_at: new Date('2026-11-20T01:00:00Z'),
        ...x,
      }),
    );
  });

  describe('getMyCart', () => {
    it('giỏ trống → không gọi catalog, subtotal 0', async () => {
      itemRepo.find.mockResolvedValue([]);

      await expect(service.getMyCart('u1')).resolves.toEqual({
        id: 'c1',
        items: [],
        subtotal: 0,
      });
      expect(catalog.getProducts).not.toHaveBeenCalled();
    });

    it('bình thường: body như be/ — price là chuỗi (bigint của be/), subtotal là số, không có degraded', async () => {
      itemRepo.find.mockResolvedValue([item()]);
      catalog.getProducts.mockResolvedValue([product()]);

      const res = await service.getMyCart('u1');

      expect(res).toEqual({
        id: 'c1',
        items: [
          {
            id: 'i1',
            product: {
              id: 'p1',
              name: 'Tai nghe X',
              price: '1500000',
              image: 'https://img/p1.jpg',
            },
            quantity: 2,
          },
        ],
        subtotal: 3000000,
      });
      expect(res).not.toHaveProperty('degraded');
      expect(catalog.getProducts).toHaveBeenCalledWith(['p1']);
    });

    it('đọc dòng theo added_at tăng dần (như be/)', async () => {
      itemRepo.find.mockResolvedValue([]);
      await service.getMyCart('u1');
      expect(itemRepo.find).toHaveBeenCalledWith({
        where: { cart_id: 'c1' },
        order: { added_at: 'ASC' },
      });
    });

    it('catalog lỗi (UpstreamError) → 200, dữ liệu sản phẩm null, subtotal null, degraded: true', async () => {
      itemRepo.find.mockResolvedValue([item()]);
      catalog.getProducts.mockRejectedValue(
        new UpstreamError('catalog', 'ECONNREFUSED', 'not_executed'),
      );

      await expect(service.getMyCart('u1')).resolves.toEqual({
        id: 'c1',
        items: [
          {
            id: 'i1',
            product: { id: 'p1', name: null, price: null, image: null },
            quantity: 2,
          },
        ],
        subtotal: null,
        degraded: true,
      });
    });

    it('catalog quá giờ (504) cũng degraded', async () => {
      itemRepo.find.mockResolvedValue([item()]);
      catalog.getProducts.mockRejectedValue(
        new UpstreamError('catalog', 'timeout', 'unknown', 504),
      );
      await expect(service.getMyCart('u1')).resolves.toMatchObject({
        degraded: true,
      });
    });

    it('sản phẩm đã bị xoá ở catalog → dòng đó name null, unavailable: true, không tính vào subtotal', async () => {
      itemRepo.find.mockResolvedValue([
        item(),
        item({ id: 'i2', product_id: 'p-gone', quantity: 1 }),
      ]);
      catalog.getProducts.mockResolvedValue([product()]);

      const res = await service.getMyCart('u1');

      expect(res.items[1]).toEqual({
        id: 'i2',
        product: { id: 'p-gone', name: null, price: null, image: null },
        quantity: 1,
        unavailable: true,
      });
      expect(res.items[0]).not.toHaveProperty('unavailable');
      expect(res.subtotal).toBe(3000000);
      expect(res).not.toHaveProperty('degraded');
    });

    it('lỗi khác UpstreamError không nuốt', async () => {
      itemRepo.find.mockResolvedValue([item()]);
      const boom = new Error('bug');
      catalog.getProducts.mockRejectedValue(boom);
      await expect(service.getMyCart('u1')).rejects.toBe(boom);
    });
  });

  describe('addItem', () => {
    it('sản phẩm không có → 404 NT-ORD-1011, không ghi', async () => {
      catalog.getProducts.mockResolvedValue([]);

      await expect(
        codeOf(service.addItem('u1', { product_id: 'p1', quantity: 1 })),
      ).resolves.toEqual({
        code: 'NT-ORD-1011',
        status: 404,
        message: 'Không tìm thấy sản phẩm',
      });
      expect(itemRepo.save).not.toHaveBeenCalled();
    });

    it('sản phẩm ngừng bán (is_active=false) → 404 NT-ORD-1011 (be/ lọc is_active: true)', async () => {
      catalog.getProducts.mockResolvedValue([product({ is_active: false })]);
      await expect(
        codeOf(service.addItem('u1', { product_id: 'p1', quantity: 1 })),
      ).resolves.toMatchObject({ code: 'NT-ORD-1011' });
    });

    it('trong giỏ + thêm vượt tồn kho → 400 NT-ORD-1005, câu chữ như be/', async () => {
      catalog.getProducts.mockResolvedValue([product({ stock_quantity: 5 })]);
      itemRepo.findOne.mockResolvedValue(item({ quantity: 4 }));

      await expect(
        codeOf(service.addItem('u1', { product_id: 'p1', quantity: 2 })),
      ).resolves.toEqual({
        code: 'NT-ORD-1005',
        status: 400,
        message: 'Sản phẩm "Tai nghe X" chỉ còn 5 trong kho',
      });
      expect(itemRepo.save).not.toHaveBeenCalled();
    });

    it('đã có trong giỏ → cộng dồn số lượng', async () => {
      catalog.getProducts.mockResolvedValue([product()]);
      itemRepo.findOne.mockResolvedValue(item({ quantity: 2 }));

      const res = await service.addItem('u1', {
        product_id: 'p1',
        quantity: 3,
      });

      expect(itemRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'i1', quantity: 5 }),
      );
      expect(res).toEqual({
        id: 'i1',
        product_id: 'p1',
        quantity: 5,
        added_at: new Date('2026-11-20T00:00:00Z'),
      });
    });

    it('chưa có → tạo dòng mới; không gửi quantity thì mặc định 1', async () => {
      catalog.getProducts.mockResolvedValue([product()]);
      itemRepo.findOne.mockResolvedValue(null);

      const res = await service.addItem('u1', { product_id: 'p1' });

      expect(itemRepo.create).toHaveBeenCalledWith({
        cart_id: 'c1',
        product_id: 'p1',
        quantity: 1,
      });
      expect(res).toEqual({
        id: 'i-new',
        product_id: 'p1',
        quantity: 1,
        added_at: new Date('2026-11-20T01:00:00Z'),
      });
    });

    it('catalog lỗi → ném UpstreamError (filter trả 503), không ghi', async () => {
      const down = new UpstreamError('catalog', 'ECONNREFUSED', 'not_executed');
      catalog.getProducts.mockRejectedValue(down);

      await expect(
        service.addItem('u1', { product_id: 'p1', quantity: 1 }),
      ).rejects.toBe(down);
      expect(itemRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('updateItem', () => {
    it('dòng không thuộc giỏ → 404 NT-ORD-1010, không gọi catalog', async () => {
      itemRepo.findOne.mockResolvedValue(null);

      await expect(
        codeOf(service.updateItem('u1', 'i-x', { quantity: 1 })),
      ).resolves.toEqual({
        code: 'NT-ORD-1010',
        status: 404,
        message: 'Không tìm thấy sản phẩm trong giỏ hàng',
      });
      expect(itemRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'i-x', cart_id: 'c1' },
      });
      expect(catalog.getProducts).not.toHaveBeenCalled();
    });

    it('sản phẩm đã bị xoá ở catalog → 404 NT-ORD-1011 (sổ A8)', async () => {
      itemRepo.findOne.mockResolvedValue(item());
      catalog.getProducts.mockResolvedValue([]);

      await expect(
        codeOf(service.updateItem('u1', 'i1', { quantity: 1 })),
      ).resolves.toMatchObject({ code: 'NT-ORD-1011', status: 404 });
      expect(itemRepo.save).not.toHaveBeenCalled();
    });

    it('vượt tồn kho → 400 NT-ORD-1005 (so với số lượng mới, không cộng dồn)', async () => {
      itemRepo.findOne.mockResolvedValue(item({ quantity: 2 }));
      catalog.getProducts.mockResolvedValue([product({ stock_quantity: 5 })]);

      await expect(
        codeOf(service.updateItem('u1', 'i1', { quantity: 6 })),
      ).resolves.toMatchObject({ code: 'NT-ORD-1005' });
    });

    it('hợp lệ → đặt số lượng mới, trả { id, quantity, updated_at }', async () => {
      itemRepo.findOne.mockResolvedValue(item({ quantity: 2 }));
      catalog.getProducts.mockResolvedValue([product({ stock_quantity: 5 })]);

      await expect(
        service.updateItem('u1', 'i1', { quantity: 5 }),
      ).resolves.toEqual({
        id: 'i1',
        quantity: 5,
        updated_at: new Date('2026-11-20T00:00:00Z'),
      });
    });

    it('catalog lỗi → ném UpstreamError', async () => {
      itemRepo.findOne.mockResolvedValue(item());
      const down = new UpstreamError('catalog', 'ECONNREFUSED', 'not_executed');
      catalog.getProducts.mockRejectedValue(down);
      await expect(
        service.updateItem('u1', 'i1', { quantity: 1 }),
      ).rejects.toBe(down);
    });
  });

  describe('removeItem', () => {
    it('dòng không thuộc giỏ → 404 NT-ORD-1010', async () => {
      itemRepo.findOne.mockResolvedValue(null);
      await expect(
        codeOf(service.removeItem('u1', 'i-x')),
      ).resolves.toMatchObject({ code: 'NT-ORD-1010' });
    });

    it('xoá, không gọi catalog, câu chữ như be/', async () => {
      const row = item();
      itemRepo.findOne.mockResolvedValue(row);

      await expect(service.removeItem('u1', 'i1')).resolves.toEqual({
        message: 'Đã xoá sản phẩm khỏi giỏ hàng',
      });
      expect(itemRepo.remove).toHaveBeenCalledWith(row);
      expect(catalog.getProducts).not.toHaveBeenCalled();
    });
  });
});
