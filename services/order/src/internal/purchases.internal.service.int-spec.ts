import { randomUUID } from 'node:crypto';
import { OrderItem } from '../database/entities/order-item.entity';
import { countQueries, createTestDb, seedOrder, TestDb } from '../test-helpers';
import { PurchasesInternalService } from './purchases.internal.service';

// POSTGRES THẬT. Chạy: docker compose up -d postgres && npm run test:int -w services/order -- purchases
// BR-11: đã mua = có dòng đơn thuộc đơn paid hoặc shipped. Component_Class_Design §7: pending → false.

jest.setTimeout(60_000);

describe('PurchasesInternalService (Postgres thật)', () => {
  let db: TestDb;
  let service: PurchasesInternalService;

  beforeAll(async () => {
    db = await createTestDb();
    service = new PurchasesInternalService(db.ds.getRepository(OrderItem));
  });
  afterAll(async () => db?.cleanup());
  beforeEach(async () => {
    await db.ds.query('TRUNCATE orders CASCADE');
  });
  afterEach(() => jest.restoreAllMocks());

  it.each([
    ['paid', true],
    ['shipped', true],
    ['pending', false],
    ['processing', false],
    ['cancelled', false],
    ['failed', false],
  ])('đơn %s → purchased: %s', async (status, expected) => {
    const user = randomUUID();
    const product = randomUUID();
    await seedOrder(db.ds, {
      user_id: user,
      status,
      lines: [{ product_id: product }],
    });

    await expect(service.hasPurchased(user, product)).resolves.toEqual({
      purchased: expected,
    });
  });

  it('người khác mua, hoặc mình mua sản phẩm khác → false', async () => {
    const user = randomUUID();
    const product = randomUUID();
    await seedOrder(db.ds, {
      user_id: randomUUID(),
      status: 'paid',
      lines: [{ product_id: product }],
    });
    await seedOrder(db.ds, {
      user_id: user,
      status: 'paid',
      lines: [{ product_id: randomUUID() }],
    });

    await expect(service.hasPurchased(user, product)).resolves.toEqual({
      purchased: false,
    });
  });

  it('1 truy vấn', async () => {
    const q = countQueries();
    await service.hasPurchased(randomUUID(), randomUUID());
    const n = q.count;
    q.restore();
    expect(n).toBe(1);
  });
});
