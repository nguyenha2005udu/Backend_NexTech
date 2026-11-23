import type { HttpException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { UpstreamBusinessError, UpstreamError } from '@nextech/service-kit';
import { randomUUID } from 'node:crypto';
import { EntityManager } from 'typeorm';
import type { CatalogClient } from '../../clients/catalog.client';
import type { IdentityClient } from '../../clients/identity.client';
import type { PromotionClient } from '../../clients/promotion.client';
import { Cart } from '../../database/entities/cart.entity';
import { Order } from '../../database/entities/order.entity';
import { SagaTask } from '../../database/entities/saga-task.entity';
import { countQueries, createTestDb, TestDb, noHold } from '../../test-helpers';
import { CheckoutSagaService } from './checkout-saga.service';
import { CheckoutService } from './checkout.service';
import { CompensationService } from './compensation.service';

// POSTGRES THẬT, client giả. Chạy: docker compose up -d postgres && npm run test:int -w services/order -- checkout
// NT.CHECKOUT_SAGA Component_Class_Design §8: test 1, 2, 3, 13 (confirm hai lần), 15, 16; số truy vấn
// theo Processing_Flow §1 (v1.5): 8–10. T3.4: khối "hoàn tác" — test 4–10, 14, 19, 20, 23–25 (v1.6).

jest.setTimeout(60_000);

const CFG = {
  shippingFee: 30000,
  freeShippingThreshold: 500000,
  budgetMs: 8000,
  deadlineMs: 120000,
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('CheckoutService (Postgres thật)', () => {
  let db: TestDb;
  let service: CheckoutService;
  let saga: CheckoutSagaService;
  const P1 = randomUUID();
  const P2 = randomUUID();
  const P3 = randomUUID();

  const identity = { getAddress: jest.fn(), getUser: jest.fn() };
  const catalog = {
    getProducts: jest.fn(),
    reserve: jest.fn(),
    release: jest.fn(),
  };
  const promotion = { redeem: jest.fn(), release: jest.fn() };
  let compensation: CompensationService;

  beforeAll(async () => {
    db = await createTestDb();
    const orders = db.ds.getRepository(Order);
    compensation = new CompensationService(
      orders,
      db.ds.getRepository(SagaTask),
      db.ds,
      catalog as unknown as CatalogClient,
      promotion as unknown as PromotionClient,
    );
    saga = new CheckoutSagaService(
      orders,
      db.ds,
      catalog as unknown as CatalogClient,
      promotion as unknown as PromotionClient,
      compensation,
      noHold,
    );
    service = new CheckoutService(
      db.ds.getRepository(Cart),
      orders,
      db.ds,
      identity as unknown as IdentityClient,
      catalog as unknown as CatalogClient,
      saga,
      { getOrThrow: () => CFG } as unknown as ConfigService,
    );
  });
  afterAll(async () => db?.cleanup());

  beforeEach(async () => {
    jest.clearAllMocks();
    await db.ds.query('TRUNCATE orders, carts CASCADE');
    identity.getAddress.mockImplementation((userId: string, id: string) =>
      Promise.resolve({
        id,
        user_id: userId,
        full_address: '1 Lê Lợi, Q1',
        recipient_name: 'Nguyễn A',
        phone_number: '0900000001',
      }),
    );
    identity.getUser.mockImplementation((id: string) =>
      Promise.resolve({
        id,
        email: 'a@b.c',
        full_name: 'Nguyễn Văn A',
        phone_number: '0900000000',
      }),
    );
    catalog.getProducts.mockResolvedValue([
      { id: P1, name: 'Tai nghe', price: 150000, is_active: true, image: 'i1' },
      { id: P2, name: 'Cáp', price: 50000, is_active: true, image: null },
      { id: P3, name: 'Sạc', price: 400000, is_active: true, image: null },
    ]);
    catalog.reserve.mockResolvedValue({ status: 'reserved' });
    catalog.release.mockResolvedValue({ status: 'released', restored: true });
    promotion.release.mockResolvedValue({ status: 'released', restored: true });
    promotion.redeem.mockResolvedValue({
      status: 'redeemed',
      discount_code_id: randomUUID(),
      freeship_code_id: null,
      discount_amount: 35000,
      shipping_discount_amount: 0,
    });
  });
  afterEach(() => jest.restoreAllMocks());

  // Giỏ của một người: trả id các dòng theo thứ tự sản phẩm truyền vào
  async function seedCart(
    userId: string,
    lines: Array<[string, number]>,
  ): Promise<string[]> {
    const [{ id: cartId }] = await db.ds.query<Array<{ id: string }>>(
      'INSERT INTO carts (user_id) VALUES ($1) RETURNING id',
      [userId],
    );
    const ids: string[] = [];
    for (const [productId, qty] of lines) {
      const [{ id }] = await db.ds.query<Array<{ id: string }>>(
        'INSERT INTO cart_items (cart_id, product_id, quantity) VALUES ($1, $2, $3) RETURNING id',
        [cartId, productId, qty],
      );
      ids.push(id);
    }
    return ids;
  }

  const ordersOf = (userId: string) =>
    db.ds.getRepository(Order).find({
      where: { user_id: userId },
      relations: { items: true },
    });
  const cartItemIds = async (userId: string) =>
    (
      await db.ds.query<Array<{ id: string }>>(
        'SELECT ci.id FROM cart_items ci JOIN carts c ON c.id = ci.cart_id WHERE c.user_id = $1',
        [userId],
      )
    ).map((r) => r.id);

  it('test 1: có mã → 201, pending/confirmed, tiền đúng (BR-04, BR-05), xoá dòng giỏ, 10 truy vấn', async () => {
    const u = randomUUID();
    await seedCart(u, [
      [P1, 2],
      [P2, 1],
    ]);

    const q = countQueries();
    const t0 = Date.now();
    const r = await service.checkout(
      u,
      { address_id: randomUUID(), discount_code: 'SALE10' },
      'key-1',
    );
    const n = q.count;
    q.restore();

    // subtotal 350.000 < 500.000 → ship 30.000; giảm 35.000 → total 345.000
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({
      subtotal: 350000,
      shipping_fee: 30000,
      discount_amount: 35000,
      shipping_discount_amount: 0,
      total: 345000,
      status: 'pending',
    });
    // AC-03 (T3.10, BR-19): hạn = lúc xác nhận + 15 phút
    const exp = (r.body as { payment_expires_at: Date }).payment_expires_at;
    expect(exp).toBeInstanceOf(Date);
    expect(exp.getTime()).toBeGreaterThanOrEqual(t0 + 15 * 60_000 - 1000);
    expect(exp.getTime()).toBeLessThanOrEqual(Date.now() + 15 * 60_000 + 1000);
    expect(promotion.redeem).toHaveBeenCalledWith(
      expect.objectContaining({
        subtotal: 350000,
        shipping_fee: 30000,
        discount_code: 'SALE10',
      }),
      expect.anything(),
    );

    const [o] = await ordersOf(u);
    expect(o).toMatchObject({
      status: 'pending',
      saga_step: 'confirmed',
      subtotal: '350000',
      total: '345000',
      discount_amount: '35000',
      discount_code: 'SALE10',
      customer_name: 'Nguyễn Văn A',
      idempotency_key: 'key-1',
    });
    expect(o.items).toHaveLength(2);
    expect(o.items.find((i) => i.product_id === P1)).toMatchObject({
      product_name: 'Tai nghe',
      unit_price: '150000',
      quantity: 2,
    });
    expect(await cartItemIds(u)).toEqual([]);
    // Processing_Flow §1 v1.5: key 1 + giỏ 1 + tạo đơn 2 + 2 setStep + confirm 2 (UPDATE, DELETE) = 8
    expect(n).toBeLessThanOrEqual(10);
    expect(n).toBe(8);
  });

  it('test 2: không mã → không gọi promotion, total = subtotal + ship; từ 500.000đ miễn ship', async () => {
    const u = randomUUID();
    await seedCart(u, [
      [P3, 1],
      [P1, 1],
    ]);

    const q = countQueries();
    const r = await service.checkout(u, { address_id: randomUUID() });
    const n = q.count;
    q.restore();

    expect(promotion.redeem).not.toHaveBeenCalled();
    expect(r.body).toMatchObject({
      subtotal: 550000,
      shipping_fee: 0,
      total: 550000,
    });
    // giỏ 1 + tạo đơn 2 + setStep 1 + confirm 2 = 6
    expect(n).toBe(6);
  });

  it('test 3: đặt một phần giỏ → dòng không chọn còn lại', async () => {
    const u = randomUUID();
    const [c1, c2] = await seedCart(u, [
      [P1, 1],
      [P2, 1],
    ]);

    await service.checkout(u, {
      address_id: randomUUID(),
      cart_item_ids: [c2],
    });

    const [o] = await ordersOf(u);
    expect(o.items.map((i) => i.product_id)).toEqual([P2]);
    expect(o.selected_cart_item_ids).toEqual([c2]);
    expect(await cartItemIds(u)).toEqual([c1]);
  });

  it('setStep cập nhật updated_at (cron dựa vào để tìm đơn kẹt)', async () => {
    const u = randomUUID();
    await seedCart(u, [[P1, 1]]);
    catalog.reserve.mockImplementation(async () => {
      await sleep(50);
      return { status: 'reserved' };
    });

    await service.checkout(u, { address_id: randomUUID() });

    const [o] = await ordersOf(u);
    expect(o.updated_at.getTime()).toBeGreaterThan(o.created_at.getTime());
  });

  it('test 15: Idempotency-Key gửi hai lần nối tiếp → một đơn, lần hai 201 như lần đầu', async () => {
    const u = randomUUID();
    await seedCart(u, [[P1, 1]]);

    const a = await service.checkout(u, { address_id: randomUUID() }, 'k');
    const b = await service.checkout(u, { address_id: randomUUID() }, 'k');

    expect(b).toEqual(a);
    expect(await ordersOf(u)).toHaveLength(1);
    expect(catalog.reserve).toHaveBeenCalledTimes(1);
  });

  it('test 15: Idempotency-Key gửi hai lần đồng thời → một đơn (index unique)', async () => {
    const u = randomUUID();
    await seedCart(u, [[P1, 1]]);
    catalog.reserve.mockImplementation(async () => {
      await sleep(300); // giữ đơn đầu ở processing khi request sau INSERT
      return { status: 'reserved' };
    });

    const rs = await Promise.all([
      service.checkout(u, { address_id: randomUUID() }, 'k2'),
      service.checkout(u, { address_id: randomUUID() }, 'k2'),
    ]);

    expect(await ordersOf(u)).toHaveLength(1);
    const ids = new Set(rs.map((r) => r.body.id));
    expect(ids.size).toBe(1);
    expect(rs.map((r) => r.status).sort()).toEqual([201, 202]);
  });

  it('test 16: hai checkout song song cùng giỏ, không key → một 409 NT-ORD-1009', async () => {
    const u = randomUUID();
    await seedCart(u, [[P1, 1]]);
    catalog.reserve.mockImplementation(async () => {
      await sleep(300);
      return { status: 'reserved' };
    });

    const rs = await Promise.allSettled([
      service.checkout(u, { address_id: randomUUID() }),
      service.checkout(u, { address_id: randomUUID() }),
    ]);

    const rejected = rs.filter((r) => r.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason as { code: string }).toMatchObject({
      code: 'NT-ORD-1009',
    });
    expect(await ordersOf(u)).toHaveLength(1);
  });

  it('test 13: request và cron cùng confirm → một bên xác nhận, xoá giỏ một lần', async () => {
    const u = randomUUID();
    await seedCart(u, [[P1, 1]]);
    // Request dừng sau khi tạo đơn (giả lập hết ngân sách) → 202, đơn processing
    jest
      .spyOn(saga, 'advance')
      .mockImplementationOnce((o) =>
        Promise.resolve({ kind: 'in_doubt', order: o }),
      );
    const r = await service.checkout(u, { address_id: randomUUID() });
    expect(r.status).toBe(202);
    jest.restoreAllMocks();
    // Kho đã giữ xong, cả request lẫn cron cùng tới bước xác nhận
    await db.ds.query(
      "UPDATE orders SET saga_step = 'stock_reserved' WHERE user_id = $1",
      [u],
    );
    const [o] = await ordersOf(u);
    expect(o).toMatchObject({ status: 'processing', notify_on_finish: true });
    const del = jest.spyOn(EntityManager.prototype, 'delete');

    const outs = await Promise.all([saga.advance(o), saga.advance(o)]);

    expect(outs.map((x) => x.kind)).toEqual(['confirmed', 'confirmed']);
    expect(catalog.reserve).not.toHaveBeenCalled();
    expect(del).toHaveBeenCalledTimes(1);
    const [after] = await ordersOf(u);
    expect(after).toMatchObject({ status: 'pending', saga_step: 'confirmed' });
    expect(await cartItemIds(u)).toEqual([]);
  });

  it('request và cron cùng advance từ started → setStep chỉ một bên ghi, không confirm hai lần (test 21)', async () => {
    const u = randomUUID();
    await seedCart(u, [[P1, 1]]);
    jest
      .spyOn(saga, 'advance')
      .mockImplementationOnce((o) =>
        Promise.resolve({ kind: 'in_doubt', order: o }),
      );
    await service.checkout(u, { address_id: randomUUID() });
    jest.restoreAllMocks();
    const [o] = await ordersOf(u);
    const del = jest.spyOn(EntityManager.prototype, 'delete');

    // Giữ kho idempotent theo order_id ở catalog nên gọi hai lần là an toàn (NT.CATALOG API_Spec §2)
    await Promise.all([saga.advance(o), saga.advance(o)]);

    expect(del).toHaveBeenCalledTimes(1);
    const [after] = await ordersOf(u);
    expect(after).toMatchObject({ status: 'pending', saga_step: 'confirmed' });
  });

  it('giỏ trống → 1001, không tạo đơn, không gọi service khác', async () => {
    const u = randomUUID();
    await seedCart(u, []);
    await expect(
      service.checkout(u, { address_id: randomUUID() }),
    ).rejects.toMatchObject({
      code: 'NT-ORD-1001',
    });
    expect(identity.getAddress).not.toHaveBeenCalled();
    expect(await ordersOf(u)).toHaveLength(0);
  });
  describe('hoàn tác (T3.4)', () => {
    const outOfStock = () =>
      new UpstreamBusinessError(
        'catalog',
        409,
        'NT-CAT-1001',
        'Sản phẩm "Tai nghe" không đủ hàng trong kho',
      );
    const codeExhausted = () =>
      new UpstreamBusinessError(
        'promotion',
        400,
        'NT-PRM-1006',
        'Mã đã hết lượt sử dụng',
      );
    const refused = (t: string) =>
      new UpstreamError(t, 'ECONNREFUSED', 'not_executed');
    const timeout = (t: string) =>
      new UpstreamError(t, 'timeout', 'unknown', 504);

    const tasksOf = (orderId: string) =>
      db.ds
        .getRepository(SagaTask)
        .find({ where: { order_id: orderId }, order: { seq: 'ASC' } });
    type Caught = HttpException & { code?: string; upstreamCode?: string };
    const errorOf = (p: Promise<unknown>): Promise<Caught> =>
      p.then(
        () => {
          throw new Error('không ném lỗi');
        },
        (e: unknown) => e as Caught,
      );

    it('test 4: giữ kho 409 → 409 mã gốc, không gọi promotion, nhả kho, failed/compensated, giỏ còn nguyên; 8 truy vấn', async () => {
      const u = randomUUID();
      const lines = await seedCart(u, [[P1, 1]]);
      catalog.reserve.mockRejectedValue(outOfStock());

      const q = countQueries();
      const e = await errorOf(
        service.checkout(u, { address_id: randomUUID() }),
      );
      const n = q.count;
      q.restore();

      expect(e.getStatus()).toBe(409);
      expect(e.upstreamCode).toBe('NT-CAT-1001');
      expect(promotion.redeem).not.toHaveBeenCalled();
      expect(catalog.release).toHaveBeenCalledTimes(1);
      const [o] = await ordersOf(u);
      expect(o).toMatchObject({
        status: 'failed',
        saga_step: 'compensated',
        failure_code: 'NT-CAT-1001',
        failure_status: 409,
      });
      expect((await tasksOf(o.id)).map((t) => [t.type, t.status])).toEqual([
        ['release_stock', 'done'],
      ]);
      expect(await cartItemIds(u)).toEqual(lines);
      // giỏ 1 + tạo đơn 2 + start 2 + run (SELECT + done) 2 + finish 1
      expect(n).toBe(8);
    });

    it('giữ kho 409 khi có mã → vẫn nhả cả mã (tombstone) dù chưa dùng mã', async () => {
      const u = randomUUID();
      await seedCart(u, [[P1, 1]]);
      catalog.reserve.mockRejectedValue(outOfStock());

      await errorOf(
        service.checkout(u, {
          address_id: randomUUID(),
          discount_code: 'SALE10',
        }),
      );

      const [o] = await ordersOf(u);
      expect((await tasksOf(o.id)).map((t) => [t.type, t.status])).toEqual([
        ['release_promotion', 'done'],
        ['release_stock', 'done'],
      ]);
      expect(promotion.redeem).not.toHaveBeenCalled();
      expect(promotion.release).toHaveBeenCalledTimes(1);
    });

    it('test 5 + 14: dùng mã 4xx → 4xx, nhả mã rồi nhả kho, mỗi lệnh một lần, failed; 10 truy vấn', async () => {
      const u = randomUUID();
      await seedCart(u, [[P1, 1]]);
      promotion.redeem.mockRejectedValue(codeExhausted());
      const calls: string[] = [];
      promotion.release.mockImplementation(() => {
        calls.push('promotion');
        return Promise.resolve({ status: 'released', restored: false });
      });
      catalog.release.mockImplementation(() => {
        calls.push('catalog');
        return Promise.resolve({ status: 'released', restored: true });
      });

      const q = countQueries();
      const e = await errorOf(
        service.checkout(
          u,
          { address_id: randomUUID(), discount_code: 'HETLUOT' },
          'k5',
        ),
      );
      const n = q.count;
      q.restore();

      expect(e.getStatus()).toBe(400);
      expect(e.upstreamCode).toBe('NT-PRM-1006');
      expect(calls).toEqual(['promotion', 'catalog']);
      const [o] = await ordersOf(u);
      expect(o).toMatchObject({
        status: 'failed',
        saga_step: 'compensated',
        idempotency_key: 'k5',
      });
      // key 1 + giỏ 1 + tạo đơn 2 + setStep 1 + start 2 + run 2 + finish 1
      expect(n).toBe(10);
    });

    it('test 6 + 23: giữ kho not_executed → 503, failed; nhả key → gửi lại cùng key tạo đơn mới', async () => {
      const u = randomUUID();
      await seedCart(u, [[P1, 1]]);
      catalog.reserve.mockRejectedValueOnce(refused('catalog'));

      const e = await errorOf(
        service.checkout(u, { address_id: randomUUID() }, 'k6'),
      );
      expect(e.getStatus()).toBe(503);
      const [first] = await ordersOf(u);
      expect(first).toMatchObject({
        status: 'failed',
        failure_code: 'NT-GEN-0503',
        idempotency_key: null,
      });

      const r = await service.checkout(u, { address_id: randomUUID() }, 'k6');
      expect(r.status).toBe(201);
      expect(r.body.id).not.toBe(first.id);
      expect(await ordersOf(u)).toHaveLength(2);
    });

    it('test 24: giữ kho 409 rồi gửi lại cùng key → 409 mã cũ, không chạy saga lần hai', async () => {
      const u = randomUUID();
      await seedCart(u, [[P1, 1]]);
      catalog.reserve.mockRejectedValue(outOfStock());
      await errorOf(service.checkout(u, { address_id: randomUUID() }, 'k24'));

      const e = await errorOf(
        service.checkout(u, { address_id: randomUUID() }, 'k24'),
      );

      expect(e.getStatus()).toBe(409);
      expect(e.code).toBe('NT-CAT-1001');
      expect(catalog.reserve).toHaveBeenCalledTimes(1);
      expect(await ordersOf(u)).toHaveLength(1);
    });

    it('test 7: giữ kho unknown → 202, processing, chưa hoàn tác', async () => {
      const u = randomUUID();
      await seedCart(u, [[P1, 1]]);
      catalog.reserve.mockRejectedValue(timeout('catalog'));

      const r = await service.checkout(u, { address_id: randomUUID() });

      expect(r.status).toBe(202);
      const [o] = await ordersOf(u);
      expect(o).toMatchObject({
        status: 'processing',
        saga_step: 'started',
        notify_on_finish: true,
      });
      expect(await tasksOf(o.id)).toHaveLength(0);
      expect(catalog.release).not.toHaveBeenCalled();
    });

    it('test 9: dùng mã unknown → 202, kho vẫn giữ', async () => {
      const u = randomUUID();
      await seedCart(u, [[P1, 1]]);
      promotion.redeem.mockRejectedValue(timeout('promotion'));

      const r = await service.checkout(u, {
        address_id: randomUUID(),
        discount_code: 'SALE10',
      });

      expect(r.status).toBe(202);
      const [o] = await ordersOf(u);
      expect(o).toMatchObject({
        status: 'processing',
        saga_step: 'stock_reserved',
      });
      expect(catalog.release).not.toHaveBeenCalled();
    });

    it('test 8: dùng mã not_executed, promotion vẫn chết → 503, kho nhả ngay, đơn compensating chờ nhả mã', async () => {
      const u = randomUUID();
      await seedCart(u, [[P1, 1]]);
      promotion.redeem.mockRejectedValue(refused('promotion'));
      promotion.release.mockRejectedValue(refused('promotion'));

      const e = await errorOf(
        service.checkout(u, {
          address_id: randomUUID(),
          discount_code: 'SALE10',
        }),
      );

      expect(e.getStatus()).toBe(503);
      expect(catalog.release).toHaveBeenCalledTimes(1);
      const [o] = await ordersOf(u);
      expect(o).toMatchObject({
        status: 'processing',
        saga_step: 'compensating',
      });
      const ts = await tasksOf(o.id);
      expect(ts.map((t) => [t.type, t.status, t.attempts])).toEqual([
        ['release_promotion', 'pending', 1],
        ['release_stock', 'done', 0],
      ]);
      expect(ts[0].last_error).toBe('promotion ECONNREFUSED (not_executed)');
    });

    it('test 10: nhả kho lỗi → compensating; chạy lại (thay cron T3.5) → failed, chỉ nhả task còn tồn', async () => {
      const u = randomUUID();
      await seedCart(u, [[P1, 1]]);
      catalog.reserve.mockRejectedValue(outOfStock());
      catalog.release.mockRejectedValueOnce(refused('catalog'));

      await errorOf(service.checkout(u, { address_id: randomUUID() }));
      const [o] = await ordersOf(u);
      expect(o).toMatchObject({
        status: 'processing',
        saga_step: 'compensating',
      });

      await compensation.run(o.id);

      expect(catalog.release).toHaveBeenCalledTimes(2);
      const [after] = await ordersOf(u);
      expect(after).toMatchObject({
        status: 'failed',
        saga_step: 'compensated',
      });
      expect((await tasksOf(o.id))[0]).toMatchObject({
        status: 'done',
        attempts: 1,
      });
    });

    it('test 25: đơn cũ đang compensating không khoá giỏ → đặt lại được ngay', async () => {
      const u = randomUUID();
      await seedCart(u, [[P1, 1]]);
      catalog.reserve.mockRejectedValueOnce(outOfStock());
      catalog.release.mockRejectedValueOnce(refused('catalog'));
      await errorOf(service.checkout(u, { address_id: randomUUID() }));

      const r = await service.checkout(u, { address_id: randomUUID() });

      expect(r.status).toBe(201);
      const statuses = (await ordersOf(u))
        .map((o) => `${o.status}/${o.saga_step}`)
        .sort();
      expect(statuses).toEqual([
        'pending/confirmed',
        'processing/compensating',
      ]);
    });

    it('test 19: request và cron cùng startForFailedSaga → một bộ task, nhả một lần', async () => {
      const u = randomUUID();
      await seedCart(u, [[P1, 1]]);
      jest
        .spyOn(saga, 'advance')
        .mockImplementationOnce((o) =>
          Promise.resolve({ kind: 'in_doubt', order: o }),
        );
      await service.checkout(u, {
        address_id: randomUUID(),
        discount_code: 'SALE10',
      });
      jest.restoreAllMocks();
      const [o] = await ordersOf(u);

      await Promise.all([
        compensation.startForFailedSaga(o, outOfStock()),
        compensation.startForFailedSaga(o, refused('catalog')),
      ]);

      expect(await tasksOf(o.id)).toHaveLength(2);
      expect(catalog.release).toHaveBeenCalledTimes(1);
      expect(promotion.release).toHaveBeenCalledTimes(1);
      const [after] = await ordersOf(u);
      expect(after.status).toBe('failed');
    });

    it('test 20: finish muộn khi đơn đã pending → không đổi', async () => {
      const u = randomUUID();
      await seedCart(u, [[P1, 1]]);
      const r = await service.checkout(u, { address_id: randomUUID() });

      await compensation.run(r.body.id);

      const [o] = await ordersOf(u);
      expect(o).toMatchObject({ status: 'pending', saga_step: 'confirmed' });
    });
  });
});
