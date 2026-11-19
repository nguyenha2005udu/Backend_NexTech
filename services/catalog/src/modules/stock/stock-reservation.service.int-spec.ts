import { randomUUID } from 'node:crypto';
import { BusinessException } from '@nextech/service-kit';
import { Product } from '../../database/entities/product.entity';
import { StockReservation } from '../../database/entities/stock-reservation.entity';
import { StockReservationItem } from '../../database/entities/stock-reservation-item.entity';
import { createTestDb, TestDb } from '../../test-helpers';
import { StockReservationService } from './stock-reservation.service';

// POSTGRES THẬT — không mock (tdd-guide §5). Chạy: docker compose up -d postgres
//   npm run test:int -w services/catalog -- stock-reservation
// Các ca giữ kho / nhả kho ở NT.CATALOG Component_Class_Design §6 (BR-01, BR-07, saga).

jest.setTimeout(60_000);

describe('StockReservationService (Postgres thật)', () => {
  let db: TestDb;
  let service: StockReservationService;

  beforeAll(async () => {
    db = await createTestDb();
    service = new StockReservationService(db.ds);
  });
  afterAll(async () => db?.cleanup());
  beforeEach(async () => {
    await db.ds.query(
      'TRUNCATE stock_reservation_items, stock_reservations, products CASCADE',
    );
  });

  async function addProduct(over: Partial<Product> = {}): Promise<Product> {
    return db.ds.getRepository(Product).save({
      name: `SP ${randomUUID().slice(0, 8)}`,
      price: 1_000_000,
      stock_quantity: 10,
      ...over,
    } as Product);
  }
  const stock = async (id: string) =>
    (await db.ds.getRepository(Product).findOneByOrFail({ id })).stock_quantity;
  const errOf = (e: unknown) => ({
    status: (e as BusinessException).getStatus(),
    code: (e as BusinessException).code,
  });
  const rejected = (results: PromiseSettledResult<unknown>[]) =>
    results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');

  it('20 lệnh đồng thời, tồn kho 5 → đúng 5 thành công, kho về 0, không âm (BR-01)', async () => {
    const p = await addProduct({ stock_quantity: 5 });

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        service.reserve(randomUUID(), [{ product_id: p.id, quantity: 1 }]),
      ),
    );

    const failed = rejected(results);
    expect(results.length - failed.length).toBe(5);
    expect(failed.map((r) => errOf(r.reason))).toEqual(
      Array(15).fill({ status: 409, code: 'NT-CAT-1001' }),
    );
    expect(await stock(p.id)).toBe(0);
    const [{ min }] = await db.ds.query<{ min: number }[]>(
      'SELECT min(stock_quantity) AS min FROM products',
    );
    expect(Number(min)).toBeGreaterThanOrEqual(0);
    expect(await db.ds.getRepository(StockReservation).count()).toBe(5);
    expect(await db.ds.getRepository(StockReservationItem).count()).toBe(5);
  });

  it('reserve hai lần cùng order_id → trừ một lần, lần hai created=false', async () => {
    const p = await addProduct({ stock_quantity: 10 });
    const orderId = randomUUID();
    const items = [{ product_id: p.id, quantity: 3 }];

    const first = await service.reserve(orderId, items);
    const second = await service.reserve(orderId, items);

    expect(first).toEqual({
      created: true,
      reservation: { order_id: orderId, status: 'reserved' },
    });
    expect(second).toEqual({
      created: false,
      reservation: { order_id: orderId, status: 'reserved' },
    });
    expect(await stock(p.id)).toBe(7);
  });

  it('reserve đồng thời cùng order_id → chỉ trừ một lần', async () => {
    const p = await addProduct({ stock_quantity: 10 });
    const orderId = randomUUID();

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        service.reserve(orderId, [{ product_id: p.id, quantity: 2 }]),
      ),
    );

    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(await stock(p.id)).toBe(8);
  });

  it('sản phẩm thứ hai hết hàng → sản phẩm đầu không bị trừ, không có phiếu', async () => {
    const [a, b] = (
      await Promise.all([addProduct(), addProduct({ name: 'Chuột Y' })])
    ).sort((x, y) => (x.id < y.id ? -1 : 1));
    // Sản phẩm đứng sau theo thứ tự khoá là sản phẩm hết hàng
    await db.ds.getRepository(Product).update(b.id, { stock_quantity: 0 });
    const orderId = randomUUID();

    const err = await service
      .reserve(orderId, [
        { product_id: b.id, quantity: 1 },
        { product_id: a.id, quantity: 2 },
      ])
      .catch((e: unknown) => e);

    expect(errOf(err)).toEqual({ status: 409, code: 'NT-CAT-1001' });
    expect((err as Error).message).toBe(
      `Sản phẩm "${b.name}" không đủ hàng trong kho`,
    );
    expect(await stock(a.id)).toBe(10);
    expect(
      await db.ds
        .getRepository(StockReservation)
        .countBy({ order_id: orderId }),
    ).toBe(0);
  });

  it('sản phẩm is_active=false → 409 NT-CAT-1002, kho không đổi', async () => {
    const p = await addProduct({ name: 'Loa Z', is_active: false });

    const err = await service
      .reserve(randomUUID(), [{ product_id: p.id, quantity: 1 }])
      .catch((e: unknown) => e);

    expect(errOf(err)).toEqual({ status: 409, code: 'NT-CAT-1002' });
    expect((err as Error).message).toBe('Sản phẩm "Loa Z" hiện không khả dụng');
    expect(await stock(p.id)).toBe(10);
  });

  it('sản phẩm không tồn tại → 409 NT-CAT-1002 kèm id', async () => {
    const missing = randomUUID();

    const err = await service
      .reserve(randomUUID(), [{ product_id: missing, quantity: 1 }])
      .catch((e: unknown) => e);

    expect(errOf(err)).toEqual({ status: 409, code: 'NT-CAT-1002' });
    expect((err as Error).message).toBe(
      `Sản phẩm "${missing}" hiện không khả dụng`,
    );
  });

  describe('get', () => {
    it('có phiếu → { order_id, status }', async () => {
      const p = await addProduct();
      const orderId = randomUUID();
      await service.reserve(orderId, [{ product_id: p.id, quantity: 1 }]);

      expect(await service.get(orderId)).toEqual({
        order_id: orderId,
        status: 'reserved',
      });
    });

    it('chưa có → 404 NT-CAT-1004', async () => {
      const err = await service.get(randomUUID()).catch((e: unknown) => e);

      expect(errOf(err)).toEqual({ status: 404, code: 'NT-CAT-1004' });
      expect((err as Error).message).toBe('Không tìm thấy phiếu giữ kho');
    });
  });

  describe('release', () => {
    it('release hai lần → cộng kho một lần, lần hai restored=false (BR-07)', async () => {
      const [a, b] = await Promise.all([addProduct(), addProduct()]);
      const orderId = randomUUID();
      await service.reserve(orderId, [
        { product_id: a.id, quantity: 3 },
        { product_id: b.id, quantity: 1 },
      ]);

      const first = await service.release(orderId);
      const second = await service.release(orderId);

      expect(first).toEqual({ status: 'released', restored: true });
      expect(second).toEqual({ status: 'released', restored: false });
      expect(await stock(a.id)).toBe(10);
      expect(await stock(b.id)).toBe(10);
      const r = await db.ds
        .getRepository(StockReservation)
        .findOneByOrFail({ order_id: orderId });
      expect(r.status).toBe('released');
      expect(r.released_at).toBeInstanceOf(Date);
    });

    it('release đồng thời cùng đơn → chỉ cộng một lần', async () => {
      const p = await addProduct();
      const orderId = randomUUID();
      await service.reserve(orderId, [{ product_id: p.id, quantity: 4 }]);

      const results = await Promise.all(
        Array.from({ length: 5 }, () => service.release(orderId)),
      );

      expect(results.filter((r) => r.restored)).toHaveLength(1);
      expect(await stock(p.id)).toBe(10);
    });

    it('release trước (tombstone), reserve sau → 409 NT-CAT-1003, kho không đổi (saga)', async () => {
      const p = await addProduct();
      const orderId = randomUUID();

      expect(await service.release(orderId)).toEqual({
        status: 'released',
        restored: false,
      });
      const err = await service
        .reserve(orderId, [{ product_id: p.id, quantity: 2 }])
        .catch((e: unknown) => e);

      expect(errOf(err)).toEqual({ status: 409, code: 'NT-CAT-1003' });
      expect((err as Error).message).toBe(
        'Phiếu giữ kho của đơn này đã bị huỷ',
      );
      expect(await stock(p.id)).toBe(10);
      expect(await service.get(orderId)).toEqual({
        order_id: orderId,
        status: 'released',
      });
    });

    it('sản phẩm đã bị xoá sau khi giữ → bỏ qua dòng đó, vẫn released', async () => {
      const [a, b] = await Promise.all([addProduct(), addProduct()]);
      const orderId = randomUUID();
      await service.reserve(orderId, [
        { product_id: a.id, quantity: 2 },
        { product_id: b.id, quantity: 2 },
      ]);
      await db.ds.getRepository(Product).delete(b.id);

      expect(await service.release(orderId)).toEqual({
        status: 'released',
        restored: true,
      });
      expect(await stock(a.id)).toBe(10);
    });
  });

  it('hai đơn đảo thứ tự sản phẩm chạy đồng thời, kèm nhả kho → không deadlock, tổng kho đúng', async () => {
    const [p1, p2] = await Promise.all([
      addProduct({ stock_quantity: 1000 }),
      addProduct({ stock_quantity: 1000 }),
    ]);
    const rounds = 20;
    let prev: string | null = null;

    for (let i = 0; i < rounds; i++) {
      const x = randomUUID();
      const y = randomUUID();
      const results = await Promise.allSettled([
        service.reserve(x, [
          { product_id: p1.id, quantity: 1 },
          { product_id: p2.id, quantity: 1 },
        ]),
        service.reserve(y, [
          { product_id: p2.id, quantity: 1 },
          { product_id: p1.id, quantity: 1 },
        ]),
        ...(prev ? [service.release(prev)] : []),
      ]);
      // Deadlock (40P01) sẽ làm một lệnh bị huỷ và rơi vào đây
      expect(rejected(results).map((r) => String(r.reason))).toEqual([]);
      prev = x;
    }

    // Mỗi vòng giữ 2 đơn; nhả lại rounds - 1 đơn x
    const expected = 1000 - rounds * 2 + (rounds - 1);
    expect(await stock(p1.id)).toBe(expected);
    expect(await stock(p2.id)).toBe(expected);
  });
});
