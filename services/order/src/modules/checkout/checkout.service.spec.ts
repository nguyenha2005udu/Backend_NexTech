import { HttpException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import {
  BusinessException,
  UpstreamBusinessError,
  UpstreamError,
} from '@nextech/service-kit';
import {
  QueryFailedError,
  type DataSource,
  type EntityManager,
  type Repository,
} from 'typeorm';
import type { CatalogClient } from '../../clients/catalog.client';
import type { IdentityClient } from '../../clients/identity.client';
import type { Cart } from '../../database/entities/cart.entity';
import { Order } from '../../database/entities/order.entity';
import { OrderItem } from '../../database/entities/order-item.entity';
import type { CheckoutSagaService } from './checkout-saga.service';
import { CheckoutService } from './checkout.service';

// NT.CHECKOUT_SAGA API_Spec §1: thứ tự kiểm tra trước khi tạo đơn (v1.5: giỏ trước địa chỉ, sổ A9),
// snapshot, Idempotency-Key, đổi SagaOutcome thành 201/202. Câu chữ lỗi như be/ checkout.
// Unique index, transaction thật, số truy vấn: checkout.service.int-spec.ts.

const CFG = {
  shippingFee: 30000,
  freeShippingThreshold: 500000,
  budgetMs: 8000,
  deadlineMs: 120000,
};
const CREATED = new Date('2026-11-20T03:00:00Z');

describe('CheckoutService.checkout', () => {
  let cart: { id: string; items: Array<Record<string, unknown>> } | null;
  const qb = {
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getOne: jest.fn(() => Promise.resolve(cart)),
  };
  const cartRepo = { createQueryBuilder: jest.fn(() => qb) };
  const orderRepo = { findOne: jest.fn(), update: jest.fn() };
  const m = {
    create: jest.fn((_e: unknown, d: object) => ({ ...d })),
    save: jest.fn((o: object) =>
      Promise.resolve({ ...o, id: 'o1', created_at: CREATED }),
    ),
    insert: jest.fn(),
  };
  const dataSource = {
    transaction: jest.fn((cb: (em: EntityManager) => Promise<unknown>) =>
      cb(m as unknown as EntityManager),
    ),
  };
  const identity = { getAddress: jest.fn(), getUser: jest.fn() };
  const catalog = { getProducts: jest.fn() };
  const saga = { advance: jest.fn() };
  const config = { getOrThrow: jest.fn(() => CFG) };

  const service = new CheckoutService(
    cartRepo as unknown as Repository<Cart>,
    orderRepo as unknown as Repository<Order>,
    dataSource as unknown as DataSource,
    identity as unknown as IdentityClient,
    catalog as unknown as CatalogClient,
    saga as unknown as CheckoutSagaService,
    config as unknown as ConfigService,
  );

  const DTO = { address_id: 'a1' };
  const errorOf = (p: Promise<unknown>): Promise<HttpException> =>
    p.then(
      () => {
        throw new Error('không ném lỗi');
      },
      (e: unknown) => e as HttpException,
    );
  const codeOf = (e: unknown) => (e as BusinessException).code;

  beforeEach(() => {
    jest.clearAllMocks();
    cart = {
      id: 'cart1',
      items: [
        { id: 'c1', product_id: 'p1', quantity: 2 },
        { id: 'c2', product_id: 'p2', quantity: 1 },
      ],
    };
    orderRepo.findOne.mockResolvedValue(null);
    identity.getAddress.mockResolvedValue({
      id: 'a1',
      full_address: '1 Lê Lợi, Q1',
      recipient_name: 'Nguyễn A',
      phone_number: '0900000001',
    });
    identity.getUser.mockResolvedValue({
      id: 'u1',
      email: 'a@b.c',
      full_name: 'Nguyễn Văn A',
      phone_number: '0900000000',
    });
    catalog.getProducts.mockResolvedValue([
      {
        id: 'p1',
        name: 'Tai nghe',
        price: 150000,
        is_active: true,
        image: 'img1',
      },
      { id: 'p2', name: 'Cáp', price: 50000, is_active: true, image: null },
    ]);
    saga.advance.mockImplementation((o: Order) =>
      Promise.resolve({
        kind: 'confirmed',
        order: { ...o, status: 'pending', saga_step: 'confirmed' },
      }),
    );
  });

  describe('thứ tự kiểm tra (API_Spec §1)', () => {
    it('không có giỏ → 400 NT-ORD-1001 "Giỏ hàng trống", chưa gọi identity', async () => {
      cart = null;
      const e = await errorOf(service.checkout('u1', DTO));
      expect(codeOf(e)).toBe('NT-ORD-1001');
      expect(e.message).toBe('Giỏ hàng trống');
      expect(identity.getAddress).not.toHaveBeenCalled();
    });

    it('giỏ trống + địa chỉ sai → 1001 (v1.5: giỏ trước địa chỉ)', async () => {
      cart = { id: 'cart1', items: [] };
      identity.getAddress.mockRejectedValue(
        new UpstreamBusinessError('identity', 404, 'NT-IDN-1004', 'x'),
      );
      expect(codeOf(await errorOf(service.checkout('u1', DTO)))).toBe(
        'NT-ORD-1001',
      );
    });

    it('cart_item_ids có dòng không thuộc giỏ → 400 NT-ORD-1003', async () => {
      const e = await errorOf(
        service.checkout('u1', { ...DTO, cart_item_ids: ['c1', 'c-x'] }),
      );
      expect(codeOf(e)).toBe('NT-ORD-1003');
      expect(e.message).toBe(
        'Có sản phẩm đã chọn không còn trong giỏ hàng, vui lòng tải lại giỏ',
      );
    });

    it('identity 404 địa chỉ → 400 NT-ORD-1002, không tạo đơn', async () => {
      identity.getAddress.mockRejectedValue(
        new UpstreamBusinessError('identity', 404, 'NT-IDN-1004', 'x'),
      );
      const e = await errorOf(service.checkout('u1', DTO));
      expect(codeOf(e)).toBe('NT-ORD-1002');
      expect(e.message).toBe('Địa chỉ giao hàng không hợp lệ');
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('địa chỉ 404 thắng lỗi của getUser, getProducts (kiểm theo thứ tự dù gọi song song)', async () => {
      identity.getAddress.mockRejectedValue(
        new UpstreamBusinessError('identity', 404, 'NT-IDN-1004', 'x'),
      );
      identity.getUser.mockRejectedValue(
        new UpstreamError('identity', 'x', 'unknown', 504),
      );
      catalog.getProducts.mockRejectedValue(
        new UpstreamError('catalog', 'x', 'not_executed'),
      );
      expect(codeOf(await errorOf(service.checkout('u1', DTO)))).toBe(
        'NT-ORD-1002',
      );
    });

    it('identity lỗi hạ tầng → 503/504 nguyên, không tạo đơn', async () => {
      const err = new UpstreamError('identity', 'ECONNREFUSED', 'not_executed');
      identity.getUser.mockRejectedValue(err);
      expect(await errorOf(service.checkout('u1', DTO))).toBe(err);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('sản phẩm thiếu ở catalog → 400 NT-ORD-1004 với id (như be/ khi product null)', async () => {
      catalog.getProducts.mockResolvedValue([
        {
          id: 'p1',
          name: 'Tai nghe',
          price: 150000,
          is_active: true,
          image: null,
        },
      ]);
      const e = await errorOf(service.checkout('u1', DTO));
      expect(codeOf(e)).toBe('NT-ORD-1004');
      expect(e.message).toBe('Sản phẩm "p2" hiện không khả dụng');
    });

    it('sản phẩm is_active=false → 1004 với tên', async () => {
      catalog.getProducts.mockResolvedValue([
        {
          id: 'p1',
          name: 'Tai nghe',
          price: 150000,
          is_active: false,
          image: null,
        },
        { id: 'p2', name: 'Cáp', price: 50000, is_active: true, image: null },
      ]);
      const e = await errorOf(service.checkout('u1', DTO));
      expect(e.message).toBe('Sản phẩm "Tai nghe" hiện không khả dụng');
    });

    it('catalog lỗi hạ tầng → lỗi nguyên, không tạo đơn', async () => {
      const err = new UpstreamError('catalog', 'timeout', 'unknown', 504);
      catalog.getProducts.mockRejectedValue(err);
      expect(await errorOf(service.checkout('u1', DTO))).toBe(err);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('identity, catalog nhận deadline = bây giờ + SAGA_BUDGET_MS, chỉ hỏi sản phẩm đã chọn', async () => {
      await service.checkout('u1', { ...DTO, cart_item_ids: ['c2'] });
      const deadline = (
        identity.getUser.mock.calls[0] as [string, { deadline: number }]
      )[1].deadline;
      expect(deadline).toBeGreaterThan(Date.now() + 7000);
      expect(identity.getAddress).toHaveBeenCalledWith('u1', 'a1', {
        deadline,
      });
      expect(catalog.getProducts).toHaveBeenCalledWith(['p2'], { deadline });
      expect(saga.advance).toHaveBeenCalledWith(expect.anything(), deadline);
    });
  });

  describe('tạo đơn', () => {
    it('đơn processing/started: snapshot người mua, địa chỉ, mã, giá; tiền theo BR-04', async () => {
      await service.checkout('u1', {
        ...DTO,
        discount_code: 'SALE10',
        note: 'Giao giờ hành chính',
      });

      const data = m.create.mock.calls.find(([e]) => e === Order)![1] as Record<
        string,
        unknown
      >;
      expect(data).toMatchObject({
        user_id: 'u1',
        cart_id: 'cart1',
        address_id: 'a1',
        customer_name: 'Nguyễn Văn A',
        customer_email: 'a@b.c',
        customer_phone: '0900000000',
        shipping_full_address: '1 Lê Lợi, Q1',
        shipping_recipient_name: 'Nguyễn A',
        shipping_phone_number: '0900000001',
        discount_code: 'SALE10',
        freeship_code: null,
        subtotal: '350000',
        shipping_fee: '30000',
        total: '380000',
        status: 'processing',
        saga_step: 'started',
        note: 'Giao giờ hành chính',
        selected_cart_item_ids: ['c1', 'c2'],
        idempotency_key: null,
      });
      expect((data.saga_deadline as Date).getTime()).toBeGreaterThan(
        Date.now() + 119_000,
      );
      expect(m.insert).toHaveBeenCalledWith(OrderItem, [
        {
          order_id: 'o1',
          product_id: 'p1',
          product_name: 'Tai nghe',
          product_image: 'img1',
          quantity: 2,
          unit_price: '150000',
        },
        {
          order_id: 'o1',
          product_id: 'p2',
          product_name: 'Cáp',
          product_image: null,
          quantity: 1,
          unit_price: '50000',
        },
      ]);
    });

    it('đặt một phần giỏ: chỉ dòng đã chọn vào đơn', async () => {
      await service.checkout('u1', { ...DTO, cart_item_ids: ['c2'] });
      const data = m.create.mock.calls[0][1] as Record<string, unknown>;
      expect(data).toMatchObject({
        selected_cart_item_ids: ['c2'],
        subtotal: '50000',
      });
    });

    it('201: shape như be/ (số, shipping_address), payment_expires_at null tới T3.10', async () => {
      const r = await service.checkout('u1', DTO);
      expect(r).toEqual({
        status: 201,
        body: {
          id: 'o1',
          subtotal: 350000,
          shipping_fee: 30000,
          discount_amount: 0,
          shipping_discount_amount: 0,
          total: 380000,
          status: 'pending',
          shipping_address: {
            full_address: '1 Lê Lợi, Q1',
            recipient_name: 'Nguyễn A',
            phone_number: '0900000001',
          },
          created_at: CREATED,
          payment_expires_at: null,
        },
      });
    });

    it('saga in_doubt → 202 + đặt notify_on_finish', async () => {
      saga.advance.mockImplementation((o: Order) =>
        Promise.resolve({ kind: 'in_doubt', order: o }),
      );
      const r = await service.checkout('u1', DTO);
      expect(r).toEqual({
        status: 202,
        body: {
          id: 'o1',
          status: 'processing',
          message: 'Đơn hàng đang được xử lý, vui lòng kiểm tra lại sau',
        },
      });
      expect(orderRepo.update).toHaveBeenCalledWith(
        { id: 'o1' },
        { notify_on_finish: true },
      );
    });

    it('saga failed → ném lỗi của saga', async () => {
      const err = new BusinessException(409, 'NT-CAT-1001', 'Hết hàng');
      saga.advance.mockResolvedValue({ kind: 'failed', error: err });
      expect(await errorOf(service.checkout('u1', DTO))).toBe(err);
    });
  });

  describe('Idempotency-Key', () => {
    it('dài quá 100 ký tự → 400 NT-GEN-0001, không đọc giỏ', async () => {
      const e = await errorOf(service.checkout('u1', DTO, 'k'.repeat(101)));
      expect(e.getStatus()).toBe(400);
      expect(codeOf(e)).toBe('NT-GEN-0001');
      expect(cartRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('lưu key vào đơn', async () => {
      await service.checkout('u1', DTO, 'key-1');
      expect(orderRepo.findOne).toHaveBeenCalledWith({
        where: { user_id: 'u1', idempotency_key: 'key-1' },
      });
      expect(m.create.mock.calls[0][1]).toMatchObject({
        idempotency_key: 'key-1',
      });
    });

    const existing = (o: Partial<Order>) =>
      orderRepo.findOne.mockResolvedValue({
        id: 'o-old',
        subtotal: '350000',
        shipping_fee: '30000',
        discount_amount: '0',
        shipping_discount_amount: '0',
        total: '380000',
        shipping_full_address: '1 Lê Lợi',
        shipping_recipient_name: null,
        shipping_phone_number: null,
        created_at: CREATED,
        payment_expires_at: null,
        ...o,
      });

    it('key đã dùng, đơn pending → 201 đơn cũ, không tạo đơn mới', async () => {
      existing({ status: 'pending' });
      const r = await service.checkout('u1', DTO, 'key-1');
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({
        id: 'o-old',
        total: 380000,
        status: 'pending',
      });
      expect(cartRepo.createQueryBuilder).not.toHaveBeenCalled();
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('key đã dùng, đơn processing → 202', async () => {
      existing({ status: 'processing' });
      const r = await service.checkout('u1', DTO, 'key-1');
      expect(r).toMatchObject({
        status: 202,
        body: { id: 'o-old', status: 'processing' },
      });
    });

    it('gửi đồng thời cùng key + cùng giỏ: INSERT vi phạm ux_orders_cart_processing → vẫn trả đơn theo key (test 15)', async () => {
      orderRepo.findOne
        .mockResolvedValueOnce(null) // lần đọc đầu: chưa có
        .mockResolvedValueOnce({ id: 'o-first', status: 'processing' });
      m.save.mockRejectedValueOnce(
        new QueryFailedError(
          'INSERT',
          [],
          Object.assign(new Error('dup'), {
            code: '23505',
            constraint: 'ux_orders_cart_processing',
          }),
        ),
      );
      const r = await service.checkout('u1', DTO, 'key-1');
      expect(r).toMatchObject({ status: 202, body: { id: 'o-first' } });
    });

    it('không key, vi phạm ux_orders_cart_processing → 409 NT-ORD-1009 (test 16)', async () => {
      m.save.mockRejectedValueOnce(
        new QueryFailedError(
          'INSERT',
          [],
          Object.assign(new Error('dup'), {
            code: '23505',
            constraint: 'ux_orders_cart_processing',
          }),
        ),
      );
      const e = await errorOf(service.checkout('u1', DTO));
      expect(e.getStatus()).toBe(409);
      expect(codeOf(e)).toBe('NT-ORD-1009');
      expect(e.message).toBe('Đơn hàng khác đang được xử lý, vui lòng đợi');
    });

    it('key đã dùng, đơn failed vì 4xx → ném lại lỗi cũ (test 24)', async () => {
      existing({
        status: 'failed',
        failure_status: 409,
        failure_code: 'NT-CAT-1001',
        failure_message: 'Hết hàng',
      });
      const e = await errorOf(service.checkout('u1', DTO, 'key-1'));
      expect(e.getStatus()).toBe(409);
      expect(codeOf(e)).toBe('NT-CAT-1001');
    });
  });
});
