import { randomUUID } from 'node:crypto';
import { Product } from '../database/entities/product.entity';
import { ProductImage } from '../database/entities/product-image.entity';
import { createTestDb, TestDb } from '../test-helpers';
import { ProductsInternalService } from './products.internal.service';

// POSTGRES THẬT. Chạy: docker compose up -d postgres
//   npm run test:int -w services/catalog -- products.internal
// POST /internal/products/batch, GET /internal/stats/products (NT.CATALOG API_Spec §2).

jest.setTimeout(30_000);

describe('ProductsInternalService (Postgres thật)', () => {
  let db: TestDb;
  let service: ProductsInternalService;

  beforeAll(async () => {
    db = await createTestDb();
    service = new ProductsInternalService(db.ds);
  });
  afterAll(async () => db?.cleanup());
  beforeEach(async () => {
    await db.ds.query('TRUNCATE products CASCADE');
  });

  const addProduct = (over: Partial<Product> = {}) =>
    db.ds.getRepository(Product).save({
      name: 'Tai nghe X',
      price: 1_500_000,
      stock_quantity: 10,
      ...over,
    } as Product);
  const addImage = (
    product_id: string,
    image_url: string,
    is_primary: boolean,
  ) =>
    db.ds
      .getRepository(ProductImage)
      .save({ product_id, image_url, is_primary } as ProductImage);

  describe('findBatch', () => {
    it('trả đúng shape, price là số, image là ảnh is_primary', async () => {
      const p = await addProduct();
      await addImage(p.id, 'https://img/phu.jpg', false);
      await addImage(p.id, 'https://img/chinh.jpg', true);

      expect(await service.findBatch([p.id])).toEqual({
        items: [
          {
            id: p.id,
            name: 'Tai nghe X',
            price: 1_500_000,
            stock_quantity: 10,
            is_active: true,
            image: 'https://img/chinh.jpg',
          },
        ],
      });
    });

    it('id không tồn tại thì không có trong kết quả; không có ảnh primary → image null', async () => {
      const a = await addProduct({ name: 'A' });
      const b = await addProduct({ name: 'B', is_active: false });
      await addImage(b.id, 'https://img/b.jpg', false);

      const { items } = await service.findBatch([a.id, randomUUID(), b.id]);

      expect(items.map((i) => i.id).sort()).toEqual([a.id, b.id].sort());
      expect(items.find((i) => i.id === b.id)).toMatchObject({
        is_active: false,
        image: null,
      });
    });

    it('mảng rỗng → items rỗng', async () => {
      expect(await service.findBatch([])).toEqual({ items: [] });
    });
  });

  it('stats đếm tổng và đang bán', async () => {
    await Promise.all([
      addProduct(),
      addProduct(),
      addProduct({ is_active: false }),
    ]);

    expect(await service.stats()).toEqual({
      total_products: 3,
      active_products: 2,
    });
  });
});
