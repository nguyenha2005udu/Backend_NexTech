import { UpstreamBusinessError, UpstreamError } from '@nextech/service-kit';
import type { DataSource, EntityManager, Repository } from 'typeorm';
import { In, Not } from 'typeorm';
import type { CatalogClient } from '../../clients/catalog.client';
import type { PromotionClient } from '../../clients/promotion.client';
import { CartItem } from '../../database/entities/cart-item.entity';
import { Order } from '../../database/entities/order.entity';
import { CheckoutSagaService } from './checkout-saga.service';
import type { CompensationService } from './compensation.service';

// NT.CHECKOUT_SAGA Component_Class_Design §4 (advance, setStep có điều kiện, ngân sách), §5 (confirm),
// §8 test 2 (không mã → không gọi promotion), 21 (setStep không khớp → không confirm); handleError (v1.6,
// Processing_Flow §3): 4xx / not_executed → hoàn tác + failed, unknown → in_doubt, lỗi khác ném lại.
// Transaction thật, đua request/cron: checkout.service.int-spec.ts.

describe('CheckoutSagaService.advance', () => {
  const orders = { update: jest.fn(), findOneByOrFail: jest.fn() };
  const m = {
    update: jest.fn(),
    delete: jest.fn(),
    findOneByOrFail: jest.fn(),
  };
  const dataSource = {
    transaction: jest.fn((cb: (em: EntityManager) => Promise<unknown>) =>
      cb(m as unknown as EntityManager),
    ),
  };
  const catalog = { reserve: jest.fn() };
  const promotion = { redeem: jest.fn() };
  const compensation = { startForFailedSaga: jest.fn() };
  const saga = new CheckoutSagaService(
    orders as unknown as Repository<Order>,
    dataSource as unknown as DataSource,
    catalog as unknown as CatalogClient,
    promotion as unknown as PromotionClient,
    compensation as unknown as CompensationService,
  );

  const FAR = Date.now() + 60_000;

  const order = (o: Partial<Order> = {}): Order =>
    ({
      id: 'o1',
      user_id: 'u1',
      status: 'processing',
      saga_step: 'started',
      subtotal: '200000',
      shipping_fee: '30000',
      discount_amount: '0',
      shipping_discount_amount: '0',
      total: '230000',
      discount_code: null,
      freeship_code: null,
      selected_cart_item_ids: ['c1', 'c2'],
      items: [
        { product_id: 'p1', quantity: 2 },
        { product_id: 'p2', quantity: 1 },
      ],
      ...o,
    }) as unknown as Order;

  beforeEach(() => {
    jest.clearAllMocks();
    orders.update.mockResolvedValue({ affected: 1 });
    m.update.mockResolvedValue({ affected: 1 });
    m.delete.mockResolvedValue({ affected: 2 });
    catalog.reserve.mockResolvedValue({ order_id: 'o1', status: 'reserved' });
  });

  it('không mã: giữ kho (kèm deadline) → stock_reserved → confirm; không gọi promotion (test 2)', async () => {
    const out = await saga.advance(order(), FAR);

    expect(catalog.reserve).toHaveBeenCalledWith(
      'o1',
      [
        { product_id: 'p1', quantity: 2 },
        { product_id: 'p2', quantity: 1 },
      ],
      { deadline: FAR },
    );
    expect(orders.update).toHaveBeenCalledWith(
      { id: 'o1', status: 'processing', saga_step: 'started' },
      { saga_step: 'stock_reserved' },
    );
    expect(promotion.redeem).not.toHaveBeenCalled();
    expect(m.update).toHaveBeenCalledWith(
      Order,
      { id: 'o1', status: 'processing', saga_step: Not('compensating') },
      { status: 'pending', saga_step: 'confirmed' },
    );
    expect(m.delete).toHaveBeenCalledWith(CartItem, { id: In(['c1', 'c2']) });
    expect(out.kind).toBe('confirmed');
    expect(out).toMatchObject({
      order: { status: 'pending', saga_step: 'confirmed', total: '230000' },
    });
  });

  it('có mã: redeem với subtotal, phí ship, mã; lưu số tiền giảm và total mới (BR-05)', async () => {
    promotion.redeem.mockResolvedValue({
      order_id: 'o1',
      status: 'redeemed',
      discount_code_id: 'd1',
      freeship_code_id: 'f1',
      discount_amount: 20000,
      shipping_discount_amount: 30000,
    });

    const out = await saga.advance(
      order({ discount_code: 'SALE10', freeship_code: 'SHIP' }),
      FAR,
    );

    expect(promotion.redeem).toHaveBeenCalledWith(
      {
        order_id: 'o1',
        subtotal: 200000,
        shipping_fee: 30000,
        discount_code: 'SALE10',
        freeship_code: 'SHIP',
      },
      { deadline: FAR },
    );
    expect(orders.update).toHaveBeenLastCalledWith(
      { id: 'o1', status: 'processing', saga_step: 'stock_reserved' },
      {
        saga_step: 'promotion_redeemed',
        discount_code_id: 'd1',
        freeship_code_id: 'f1',
        discount_amount: '20000',
        shipping_discount_amount: '30000',
        total: '180000',
      },
    );
    expect(out).toMatchObject({
      kind: 'confirmed',
      order: { total: '180000', status: 'pending' },
    });
  });

  it('chỉ một mã: body redeem không có trường mã còn lại', async () => {
    promotion.redeem.mockResolvedValue({
      discount_code_id: null,
      freeship_code_id: 'f1',
      discount_amount: 0,
      shipping_discount_amount: 30000,
    });
    await saga.advance(order({ freeship_code: 'SHIP' }), FAR);
    expect(promotion.redeem).toHaveBeenCalledWith(
      {
        order_id: 'o1',
        subtotal: 200000,
        shipping_fee: 30000,
        freeship_code: 'SHIP',
      },
      { deadline: FAR },
    );
  });

  it('đã stock_reserved (cron chạy tiếp): không giữ kho lại', async () => {
    await saga.advance(order({ saga_step: 'stock_reserved' }), FAR);
    expect(catalog.reserve).not.toHaveBeenCalled();
    expect(m.update).toHaveBeenCalled();
  });

  it('hết ngân sách trước khi giữ kho → in_doubt, không gọi gì', async () => {
    const out = await saga.advance(order(), Date.now() + 500);
    expect(out.kind).toBe('in_doubt');
    expect(catalog.reserve).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
  });

  it('hết ngân sách sau khi giữ kho, trước khi dùng mã → in_doubt, không redeem', async () => {
    let now = 0;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    catalog.reserve.mockImplementation(() => {
      now = 9_500; // giữ kho chậm, còn 500 ms
      return Promise.resolve({});
    });
    try {
      const out = await saga.advance(
        order({ discount_code: 'SALE10' }),
        10_000,
      );
      expect(out.kind).toBe('in_doubt');
      expect(catalog.reserve).toHaveBeenCalled();
      expect(promotion.redeem).not.toHaveBeenCalled();
      expect(m.update).not.toHaveBeenCalled();
    } finally {
      jest.restoreAllMocks();
    }
  });

  it('setStep không khớp (bên khác đã đổi đơn) → đọc lại, trả theo đơn, không confirm (test 21)', async () => {
    orders.update.mockResolvedValue({ affected: 0 });
    orders.findOneByOrFail.mockResolvedValue(
      order({ status: 'processing', saga_step: 'compensating' }),
    );

    const out = await saga.advance(order(), FAR);

    expect(orders.findOneByOrFail).toHaveBeenCalledWith({ id: 'o1' });
    expect(out.kind).toBe('in_doubt');
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('confirm thua (bên khác đã confirm) → đọc lại, không xoá giỏ lần nữa', async () => {
    m.update.mockResolvedValue({ affected: 0 });
    m.findOneByOrFail.mockResolvedValue(
      order({ status: 'pending', saga_step: 'confirmed' }),
    );

    const out = await saga.advance(order({ saga_step: 'stock_reserved' }), FAR);

    expect(m.delete).not.toHaveBeenCalled();
    expect(out).toMatchObject({
      kind: 'confirmed',
      order: { status: 'pending' },
    });
  });

  it('đơn đã có kết quả (không còn processing) → trả luôn, không gọi gì', async () => {
    const out = await saga.advance(
      order({ status: 'pending', saga_step: 'confirmed' }),
      FAR,
    );
    expect(out.kind).toBe('confirmed');
    expect(catalog.reserve).not.toHaveBeenCalled();
  });

  it('đơn đang compensating → in_doubt, không gọi gì', async () => {
    const out = await saga.advance(order({ saga_step: 'compensating' }), FAR);
    expect(out.kind).toBe('in_doubt');
    expect(catalog.reserve).not.toHaveBeenCalled();
  });

  describe('handleError (Processing_Flow §3)', () => {
    const outOfStock = new UpstreamBusinessError(
      'catalog',
      409,
      'NT-CAT-1001',
      'Hết hàng',
    );

    it('giữ kho 409 → hoàn tác với deadline, failed với lỗi gốc, không gọi promotion (test 4)', async () => {
      catalog.reserve.mockRejectedValue(outOfStock);
      const o = order({ discount_code: 'SALE10' });

      const out = await saga.advance(o, FAR);

      expect(out).toEqual({ kind: 'failed', error: outOfStock });
      expect(compensation.startForFailedSaga).toHaveBeenCalledWith(
        o,
        outOfStock,
        FAR,
      );
      expect(promotion.redeem).not.toHaveBeenCalled();
      expect(m.update).not.toHaveBeenCalled();
    });

    it('dùng mã 4xx → hoàn tác từ bước stock_reserved (test 5)', async () => {
      const bad = new UpstreamBusinessError(
        'promotion',
        400,
        'NT-PRM-1006',
        'Hết lượt',
      );
      promotion.redeem.mockRejectedValue(bad);

      const out = await saga.advance(order({ discount_code: 'HETLUOT' }), FAR);

      expect(out).toEqual({ kind: 'failed', error: bad });
      const [o] = compensation.startForFailedSaga.mock.calls[0] as [Order];
      expect(o.saga_step).toBe('stock_reserved');
    });

    it('not_executed (từ chối kết nối, mạch mở) → hoàn tác, failed 503 (test 6, 8)', async () => {
      const down = new UpstreamError('catalog', 'ECONNREFUSED', 'not_executed');
      catalog.reserve.mockRejectedValue(down);

      const out = await saga.advance(order(), FAR);

      expect(out).toEqual({ kind: 'failed', error: down });
      expect(compensation.startForFailedSaga).toHaveBeenCalled();
    });

    it('unknown (timeout, 5xx) → in_doubt, không hoàn tác (test 7, 9)', async () => {
      catalog.reserve.mockRejectedValue(
        new UpstreamError('catalog', 'timeout', 'unknown', 504),
      );

      const out = await saga.advance(order(), FAR);

      expect(out.kind).toBe('in_doubt');
      expect(compensation.startForFailedSaga).not.toHaveBeenCalled();
    });

    it('lỗi khác (DB, RESILIENCE_ENABLED=false) → ném lại, không hoàn tác', async () => {
      const boom = new Error('Service catalog trả 500');
      catalog.reserve.mockRejectedValue(boom);

      await expect(saga.advance(order(), FAR)).rejects.toBe(boom);
      expect(compensation.startForFailedSaga).not.toHaveBeenCalled();
    });
  });
});
