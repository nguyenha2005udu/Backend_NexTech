import { BusinessException } from '@nextech/service-kit';
import { In, Not, type Repository } from 'typeorm';
import type { Order } from '../../database/entities/order.entity';
import type { OrderItem } from '../../database/entities/order-item.entity';
import { OrderService } from './order.service';

// Giữ shape be/src/users/order/order.service.ts findMine, findOneMine; đọc snapshot trong order_db,
// không gọi catalog (NT.ORDER API_Spec §1 route 6, 7; Processing_Flow §3).

const CREATED = new Date('2026-11-20T01:00:00Z');
const EXPIRES = new Date('2026-11-20T01:15:00Z');

const order = (over: Partial<Order> = {}): Order =>
  ({
    id: 'o1',
    user_id: 'u1',
    subtotal: '200000',
    shipping_fee: '30000',
    discount_amount: '0',
    shipping_discount_amount: '0',
    total: '230000',
    status: 'pending',
    note: 'Giao giờ hành chính',
    shipping_full_address: '1 Lê Lợi, Hà Nội',
    shipping_recipient_name: 'Nguyễn A',
    shipping_phone_number: '0900000000',
    failure_code: null,
    failure_message: null,
    payment_expires_at: EXPIRES,
    created_at: CREATED,
    items: [],
    ...over,
  }) as Order;

const line = (over: Partial<OrderItem> = {}): OrderItem =>
  ({
    id: 'l1',
    order_id: 'o1',
    product_id: 'p1',
    product_name: 'Tai nghe X',
    product_image: 'https://img/p1.jpg',
    quantity: 2,
    unit_price: '100000',
    ...over,
  }) as OrderItem;

const notFound = async (p: Promise<unknown>) => {
  const err = await p.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(BusinessException);
  expect((err as BusinessException).code).toBe('NT-ORD-1006');
  expect((err as BusinessException).getStatus()).toBe(404);
  expect((err as BusinessException).message).toBe('Không tìm thấy đơn hàng');
};

describe('OrderService', () => {
  const orderRepo = { findAndCount: jest.fn(), findOne: jest.fn() };
  const itemRepo = { find: jest.fn() };
  // Chỉ 2 repo: không có client catalog → xem đơn không phụ thuộc catalog (Component_Class_Design §7)
  const service = new OrderService(
    orderRepo as unknown as Repository<Order>,
    itemRepo as unknown as Repository<OrderItem>,
  );

  beforeEach(() => jest.clearAllMocks());

  describe('findMine', () => {
    it('shape be/: dòng đầu cho tên, ảnh (snapshot), item_count, phân trang', async () => {
      orderRepo.findAndCount.mockResolvedValue([
        [order(), order({ id: 'o2', status: 'paid' })],
        2,
      ]);
      itemRepo.find.mockResolvedValue([
        line(),
        line({ id: 'l2', product_id: 'p2', product_name: 'Sạc' }),
      ]);

      const res = await service.findMine('u1', { page: 1, limit: 20 });

      expect(res).toEqual({
        items: [
          {
            id: 'o1',
            total: '230000',
            status: 'pending',
            created_at: CREATED,
            item_count: 2,
            product_name: 'Tai nghe X',
            product_image: 'https://img/p1.jpg',
          },
          {
            id: 'o2',
            total: '230000',
            status: 'paid',
            created_at: CREATED,
            item_count: 0,
            product_name: null,
            product_image: null,
          },
        ],
        total: 2,
        page: 1,
        limit: 20,
        totalPages: 1,
      });
      expect(itemRepo.find).toHaveBeenCalledWith({
        where: { order_id: In(['o1', 'o2']) },
      });
    });

    it('không lọc status → ẩn failed; thứ tự created_at DESC, id DESC; skip/take', async () => {
      orderRepo.findAndCount.mockResolvedValue([[], 0]);

      await service.findMine('u1', { page: 3, limit: 10 });

      expect(orderRepo.findAndCount).toHaveBeenCalledWith({
        where: { user_id: 'u1', status: Not('failed') },
        order: { created_at: 'DESC', id: 'DESC' },
        skip: 20,
        take: 10,
      });
    });

    it('lọc đúng failed → trả failed', async () => {
      orderRepo.findAndCount.mockResolvedValue([[], 0]);
      await service.findMine('u1', { status: 'failed' });
      expect(orderRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: { user_id: 'u1', status: 'failed' } }),
      );
    });

    it('mặc định page 1, limit 20; không có đơn → không đọc dòng đơn', async () => {
      orderRepo.findAndCount.mockResolvedValue([[], 0]);

      await expect(service.findMine('u1', {})).resolves.toEqual({
        items: [],
        total: 0,
        page: 1,
        limit: 20,
        totalPages: 0,
      });
      expect(itemRepo.find).not.toHaveBeenCalled();
    });
  });

  describe('findOneMine', () => {
    it('đơn của người khác hoặc không có → 404 NT-ORD-1006', async () => {
      orderRepo.findOne.mockResolvedValue(null);
      await notFound(service.findOneMine('u1', 'o-x'));
      expect(orderRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'o-x', user_id: 'u1' },
        relations: { items: true },
      });
    });

    it('shape be/ từ snapshot + payment_expires_at khi pending; không có failure', async () => {
      orderRepo.findOne.mockResolvedValue(order({ items: [line()] }));

      const res = await service.findOneMine('u1', 'o1');

      expect(res).toEqual({
        id: 'o1',
        items: [
          {
            product: {
              id: 'p1',
              name: 'Tai nghe X',
              price: '100000',
              image: 'https://img/p1.jpg',
            },
            quantity: 2,
          },
        ],
        subtotal: '200000',
        shipping_fee: '30000',
        discount_amount: '0',
        shipping_discount_amount: '0',
        total: '230000',
        status: 'pending',
        note: 'Giao giờ hành chính',
        shipping_address: {
          full_address: '1 Lê Lợi, Hà Nội',
          recipient_name: 'Nguyễn A',
          phone_number: '0900000000',
        },
        created_at: CREATED,
        payment_expires_at: EXPIRES,
      });
      expect(res).not.toHaveProperty('failure');
    });

    it('pending đã chọn COD (cột NULL) → payment_expires_at: null (BR-19)', async () => {
      orderRepo.findOne.mockResolvedValue(order({ payment_expires_at: null }));
      await expect(service.findOneMine('u1', 'o1')).resolves.toMatchObject({
        payment_expires_at: null,
      });
    });

    it.each(['paid', 'shipped', 'cancelled', 'processing'] as const)(
      '%s → payment_expires_at: null dù cột còn giá trị',
      async (status) => {
        orderRepo.findOne.mockResolvedValue(order({ status }));
        await expect(service.findOneMine('u1', 'o1')).resolves.toMatchObject({
          payment_expires_at: null,
        });
      },
    );

    it('failed → thêm failure { code, message } (NT.CHECKOUT_SAGA)', async () => {
      orderRepo.findOne.mockResolvedValue(
        order({
          status: 'failed',
          failure_code: 'NT-CAT-1001',
          failure_message: 'Sản phẩm "Tai nghe X" không đủ hàng trong kho',
        }),
      );

      await expect(service.findOneMine('u1', 'o1')).resolves.toMatchObject({
        status: 'failed',
        failure: {
          code: 'NT-CAT-1001',
          message: 'Sản phẩm "Tai nghe X" không đủ hàng trong kho',
        },
        payment_expires_at: null,
      });
    });
  });
});
