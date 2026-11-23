import { randomUUID } from 'node:crypto';
import {
  BusinessException,
  OutboxEvent,
  type EventEnvelope,
} from '@nextech/service-kit';
import { PriceAlert } from '../../database/entities/price-alert.entity';
import { Product } from '../../database/entities/product.entity';
import { ProductImage } from '../../database/entities/product-image.entity';
import { createTestDb, TestDb } from '../../test-helpers';
import { PriceAlertService } from './price-alert.service';

// POSTGRES THẬT — không mock (tdd-guide §5). Chạy: docker compose up -d postgres
//   npm run test:int -w services/catalog -- price-alert
// BR-12 đồng thời (Component_Class_Design §6) và cron theo dõi giá (Processing_Flow §4, bước T2.5).

jest.setTimeout(60_000);

describe('PriceAlertService (Postgres thật)', () => {
  let db: TestDb;
  let service: PriceAlertService;

  beforeAll(async () => {
    db = await createTestDb();
    service = new PriceAlertService(
      db.ds.getRepository(PriceAlert),
      db.ds.getRepository(Product),
      db.ds.getRepository(ProductImage),
    );
  });
  afterAll(async () => db?.cleanup());
  beforeEach(async () => {
    await db.ds.query('TRUNCATE price_alerts, products CASCADE');
  });

  const addProduct = (price: number) =>
    db.ds.getRepository(Product).save({
      name: `SP ${randomUUID().slice(0, 8)}`,
      price,
      stock_quantity: 10,
    } as Product);
  const addAlerts = (
    rows: Array<Partial<PriceAlert> & { product_id: string }>,
  ) =>
    db.ds.getRepository(PriceAlert).save(
      rows.map((r) => ({
        user_id: randomUUID(),
        target_price: 100_000,
        status: 'active' as const,
        ...r,
      })) as PriceAlert[],
    );
  const statusOf = async (id: string) =>
    db.ds.getRepository(PriceAlert).findOneByOrFail({ id });
  // Sự kiện price.alert.triggered của một sản phẩm trong outbox (T4.4)
  const outboxOf = async (productId: string) =>
    (
      await db.ds.getRepository(OutboxEvent).find({
        where: { routing_key: 'price.alert.triggered' },
      })
    )
      .map((r) => r.payload as EventEnvelope<Record<string, unknown>>)
      .filter((e) => e.data.product_id === productId);

  it('hai request theo dõi giá cùng lúc, cùng người, cùng sản phẩm → một 201, một 409 NT-CAT-1008 (BR-12)', async () => {
    const p = await addProduct(200_000);
    const userId = randomUUID();
    const dto = { product_id: p.id, target_price: 150_000 };

    const results = await Promise.allSettled([
      service.create(userId, dto),
      service.create(userId, dto),
    ]);

    const failed = results.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );
    expect(failed).toHaveLength(1);
    expect((failed[0].reason as BusinessException).code).toBe('NT-CAT-1008');
    expect(
      await db.ds
        .getRepository(PriceAlert)
        .countBy({ user_id: userId, status: 'active' }),
    ).toBe(1);
  });

  it('huỷ rồi theo dõi lại cùng sản phẩm → được (index chỉ chặn alert active)', async () => {
    const p = await addProduct(200_000);
    const userId = randomUUID();
    const first = await service.create(userId, {
      product_id: p.id,
      target_price: 150_000,
    });
    await service.remove(userId, first.id);

    await expect(
      service.create(userId, { product_id: p.id, target_price: 120_000 }),
    ).resolves.toMatchObject({ status: 'active' });
  });

  describe('checkAndTriggerAlerts (cron)', () => {
    it('giá chạm ngưỡng → triggered + triggered_at; chưa chạm và đã huỷ giữ nguyên', async () => {
      const cheap = await addProduct(90_000);
      const pricey = await addProduct(200_000);
      const [hit, equal, miss, cancelled] = await addAlerts([
        { product_id: cheap.id, target_price: 100_000 },
        { product_id: cheap.id, target_price: 90_000 },
        { product_id: pricey.id, target_price: 100_000 },
        { product_id: cheap.id, target_price: 100_000, status: 'cancelled' },
      ]);

      await expect(service.checkAndTriggerAlerts()).resolves.toBe(2);

      for (const a of [hit, equal]) {
        const row = await statusOf(a.id);
        expect(row.status).toBe('triggered');
        expect(row.triggered_at).toBeInstanceOf(Date);
      }
      expect((await statusOf(miss.id)).status).toBe('active');
      expect((await statusOf(cancelled.id)).status).toBe('cancelled');
      // Chạy lại: không còn gì để đổi
      await expect(service.checkAndTriggerAlerts()).resolves.toBe(0);

      // T4.4: đúng một sự kiện price.alert.triggered cho mỗi alert vừa đổi, cùng transaction
      const events = await outboxOf(cheap.id);
      expect(events.map((e) => e.data.alert_id).sort()).toEqual(
        [hit.id, equal.id].sort(),
      );
      const ev = events.find((e) => e.data.alert_id === hit.id)!;
      expect(ev.type).toBe('price.alert.triggered');
      expect(ev.data).toMatchObject({
        product_id: cheap.id,
        current_price: 90_000,
        target_price: 100_000,
        channel: 'app',
      });
    });

    it('hơn 100 alert chạm ngưỡng → xử lý hết theo lô', async () => {
      const p = await addProduct(50_000);
      await addAlerts(
        Array.from({ length: 250 }, () => ({ product_id: p.id })),
      );

      await expect(service.checkAndTriggerAlerts()).resolves.toBe(250);
      expect(
        await db.ds.getRepository(PriceAlert).countBy({ status: 'active' }),
      ).toBe(0);
    });

    it('hai lượt cron chạy chồng nhau → mỗi alert chỉ được đổi một lần', async () => {
      const p = await addProduct(50_000);
      await addAlerts(
        Array.from({ length: 150 }, () => ({ product_id: p.id })),
      );

      const [a, b] = await Promise.all([
        service.checkAndTriggerAlerts(),
        service.checkAndTriggerAlerts(),
      ]);

      // Tổng số dòng hai lượt thật sự đổi đúng bằng số alert: không dòng nào bị tính hai lần
      expect(a + b).toBe(150);
      expect(
        await db.ds.getRepository(PriceAlert).countBy({ status: 'triggered' }),
      ).toBe(150);
      // T4.4: mỗi lần chạm ngưỡng chỉ một sự kiện
      expect(await outboxOf(p.id)).toHaveLength(150);
    });
  });
});
