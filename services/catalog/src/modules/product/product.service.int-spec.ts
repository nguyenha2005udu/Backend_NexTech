import { randomUUID } from 'node:crypto';
import { BusinessException } from '@nextech/service-kit';
import type { IdentityClient } from '../../clients/identity.client';
import type { OrderClient } from '../../clients/order.client';
import { Product } from '../../database/entities/product.entity';
import { ProductReview } from '../../database/entities/product-review.entity';
import { createTestDb, TestDb } from '../../test-helpers';
import { ProductService } from './product.service';

// POSTGRES THẬT — không mock DB (tdd-guide §5); order, identity là client giả (T3.2 chưa có).
//   npm run test:int -w services/catalog -- product.service
// BR-11 đồng thời: Component_Class_Design §6.

jest.setTimeout(30_000);

describe('ProductService.createReview (Postgres thật)', () => {
  let db: TestDb;
  let service: ProductService;
  const orders = { hasPurchased: jest.fn().mockResolvedValue(true) };
  const identity = {
    getUserSnapshot: jest
      .fn()
      .mockResolvedValue({ full_name: 'Nguyễn A', avatar_url: null }),
  };

  beforeAll(async () => {
    db = await createTestDb();
    service = new ProductService(
      db.ds.getRepository(Product),
      db.ds.getRepository(ProductReview),
      orders as unknown as OrderClient,
      identity as unknown as IdentityClient,
    );
  });
  afterAll(async () => db?.cleanup());

  it('hai request cùng lúc, cùng người, cùng sản phẩm → một 201, một 403 NT-CAT-1007 (BR-11)', async () => {
    const p = await db.ds
      .getRepository(Product)
      .save({ name: 'Tai nghe', price: 1, stock_quantity: 1 } as Product);
    const userId = randomUUID();

    const results = await Promise.allSettled([
      service.createReview(p.id, userId, { rating: 5 }),
      service.createReview(p.id, userId, { rating: 4 }),
    ]);

    const failed = results.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );
    expect(failed).toHaveLength(1);
    const err = failed[0].reason as BusinessException;
    expect(err.getStatus()).toBe(403);
    expect(err.code).toBe('NT-CAT-1007');
    const saved = await db.ds
      .getRepository(ProductReview)
      .findBy({ product_id: p.id, user_id: userId });
    expect(saved).toHaveLength(1);
    expect(saved[0].user_name).toBe('Nguyễn A');
  });
});
