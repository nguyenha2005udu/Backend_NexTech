import { randomUUID } from 'node:crypto';
import { PostgresQueryRunner } from 'typeorm/driver/postgres/PostgresQueryRunner';
import type {
  CatalogClient,
  CatalogProduct,
} from '../../clients/catalog.client';
import { Cart } from '../../database/entities/cart.entity';
import { CartItem } from '../../database/entities/cart-item.entity';
import { createTestDb, TestDb } from '../../test-helpers';
import { CartService } from './cart.service';

// POSTGRES THẬT — không mock DB (tdd-guide §5). Catalog là giả (không phải DB của order).
// Chạy: docker compose up -d postgres
//   npm run test:int -w services/order -- cart
// Component_Class_Design §7 "Hai request tạo giỏ đồng thời → một giỏ"; non-functional §1 số truy vấn.

jest.setTimeout(60_000);

const PRODUCT: CatalogProduct = {
  id: randomUUID(),
  name: 'Tai nghe X',
  price: 1500000,
  stock_quantity: 10,
  is_active: true,
  image: null,
};

// Đếm câu SQL thật gửi Postgres, bỏ lệnh điều khiển transaction
function countQueries() {
  const spy = jest.spyOn(PostgresQueryRunner.prototype, 'query');
  return {
    get count() {
      return spy.mock.calls.filter(
        ([sql]) =>
          !/^(START TRANSACTION|COMMIT|ROLLBACK|SELECT version\(\))/i.test(
            String(sql),
          ),
      ).length;
    },
    restore: () => spy.mockRestore(),
  };
}

describe('CartService (Postgres thật)', () => {
  let db: TestDb;
  let service: CartService;
  const catalog = { getProducts: jest.fn() };

  beforeAll(async () => {
    db = await createTestDb();
    service = new CartService(
      db.ds.getRepository(Cart),
      db.ds.getRepository(CartItem),
      catalog as unknown as CatalogClient,
    );
  });
  afterAll(async () => db?.cleanup());
  beforeEach(async () => {
    await db.ds.query('TRUNCATE carts CASCADE');
    catalog.getProducts.mockReset();
    catalog.getProducts.mockResolvedValue([PRODUCT]);
  });
  afterEach(() => jest.restoreAllMocks());

  it('2 request đồng thời của cùng người dùng chưa có giỏ → đúng 1 giỏ, cả hai thấy cùng id', async () => {
    const userId = randomUUID();

    const results = await Promise.all(
      Array.from({ length: 5 }, () => service.getMyCart(userId)),
    );

    const rows = await db.ds.getRepository(Cart).find({
      where: { user_id: userId },
    });
    expect(rows).toHaveLength(1);
    expect(new Set(results.map((r) => r.id))).toEqual(new Set([rows[0].id]));
  });

  it('thêm đồng thời vào giỏ chưa tồn tại → vẫn 1 giỏ', async () => {
    const userId = randomUUID();
    const other = { ...PRODUCT, id: randomUUID() };
    catalog.getProducts.mockImplementation(([id]: string[]) =>
      Promise.resolve([id === other.id ? other : PRODUCT]),
    );

    await Promise.all([
      service.addItem(userId, { product_id: PRODUCT.id, quantity: 1 }),
      service.addItem(userId, { product_id: other.id, quantity: 1 }),
    ]);

    const carts = await db.ds.getRepository(Cart).find({
      where: { user_id: userId },
    });
    expect(carts).toHaveLength(1);
    const items = await db.ds.getRepository(CartItem).find({
      where: { cart_id: carts[0].id },
    });
    expect(items).toHaveLength(2);
  });

  it('thêm, cộng dồn, sửa, xoá chạy trên schema thật', async () => {
    const userId = randomUUID();

    const added = await service.addItem(userId, {
      product_id: PRODUCT.id,
      quantity: 2,
    });
    await service.addItem(userId, { product_id: PRODUCT.id, quantity: 3 });
    let cart = await service.getMyCart(userId);
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0].quantity).toBe(5);
    expect(cart.subtotal).toBe(7500000);

    await service.updateItem(userId, added.id, { quantity: 1 });
    cart = await service.getMyCart(userId);
    expect(cart.items[0].quantity).toBe(1);

    await service.removeItem(userId, added.id);
    cart = await service.getMyCart(userId);
    expect(cart.items).toEqual([]);
  });

  describe('số truy vấn (non-functional §1: đọc ≤ 3, ghi ≤ 6)', () => {
    it('GET /api/cart: lần đầu 3, các lần sau 2, không tăng theo số dòng', async () => {
      const userId = randomUUID();

      let q = countQueries();
      await service.getMyCart(userId);
      expect(q.count).toBe(3); // SELECT giỏ + INSERT … RETURNING + SELECT dòng
      q.restore();

      for (let i = 0; i < 5; i++) {
        const p = { ...PRODUCT, id: randomUUID() };
        catalog.getProducts.mockResolvedValueOnce([p]);
        await service.addItem(userId, { product_id: p.id, quantity: 1 });
      }
      catalog.getProducts.mockResolvedValue([]);

      q = countQueries();
      await service.getMyCart(userId);
      expect(q.count).toBe(2); // SELECT giỏ + SELECT dòng
      q.restore();
      expect(catalog.getProducts).toHaveBeenLastCalledWith(
        expect.arrayContaining([expect.any(String)]),
      );
    });

    it('POST /api/cart/items, PUT, DELETE: ≤ 6', async () => {
      const userId = randomUUID();
      await service.getMyCart(userId);

      let q = countQueries();
      const added = await service.addItem(userId, {
        product_id: PRODUCT.id,
        quantity: 1,
      });
      const addNew = q.count;
      q.restore();

      q = countQueries();
      await service.addItem(userId, { product_id: PRODUCT.id, quantity: 1 });
      const addExisting = q.count;
      q.restore();

      q = countQueries();
      await service.updateItem(userId, added.id, { quantity: 3 });
      const update = q.count;
      q.restore();

      q = countQueries();
      await service.removeItem(userId, added.id);
      const remove = q.count;
      q.restore();

      // Số đo thật (walkthrough §6); ngưỡng ghi là 6. Tăng lên thì xem lại trước khi sửa số.
      expect({ addNew, addExisting, update, remove }).toEqual({
        addNew: 3, // giỏ, tìm dòng, INSERT
        addExisting: 4, // giỏ, tìm dòng, save = SELECT + UPDATE
        update: 4, // giỏ, dòng, save = SELECT + UPDATE
        remove: 4, // giỏ, dòng, remove = SELECT + DELETE
      });
    });
  });
});
