import { randomUUID } from 'node:crypto';
import { BusinessException } from '@nextech/service-kit';
import { DiscountCode } from '../../database/entities/discount-code.entity';
import { Redemption } from '../../database/entities/redemption.entity';
import { createTestDb, TestDb } from '../../test-helpers';
import { RedemptionService } from './redemption.service';

// POSTGRES THẬT — không mock (tdd-guide §5). Chạy: docker compose up -d postgres
//   npm run test:int -w services/promotion
// Các ca ở NT.PROMOTION Component_Class_Design §5 cần đồng thời / idempotent / release.

jest.setTimeout(30_000);

describe('RedemptionService (Postgres thật)', () => {
  let db: TestDb;
  let service: RedemptionService;

  beforeAll(async () => {
    db = await createTestDb();
    service = new RedemptionService(db.ds);
  });
  afterAll(async () => db?.cleanup());
  beforeEach(async () => {
    await db.ds.query('TRUNCATE redemptions, discount_codes');
  });

  async function addCode(over: Partial<DiscountCode>): Promise<DiscountCode> {
    return db.ds.getRepository(DiscountCode).save({
      category: 'order',
      discount_type: 'percent',
      discount_value: 10,
      ...over,
    } as DiscountCode);
  }
  const usedCount = async (id: string) =>
    (await db.ds.getRepository(DiscountCode).findOneByOrFail({ id }))
      .used_count;
  const redemption = (orderId: string) =>
    db.ds.getRepository(Redemption).findOneBy({ order_id: orderId });
  const errCode = (e: unknown) => (e as BusinessException).code;

  const order = (over: Record<string, unknown> = {}) => ({
    order_id: randomUUID(),
    subtotal: 1_500_000,
    shipping_fee: 30_000,
    ...over,
  });

  it('10 đơn đồng thời, mã còn 3 lượt → đúng 3 thành công (BR-02)', async () => {
    const c = await addCode({ code: 'LIMIT3', usage_limit: 3 });

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        service.redeem(order({ discount_code: 'LIMIT3' })),
      ),
    );

    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );
    expect(ok).toHaveLength(3);
    expect(failed.map((r) => errCode(r.reason))).toEqual(
      Array(7).fill('NT-PRM-1006'),
    );
    expect(await usedCount(c.id)).toBe(3);
    expect(await db.ds.getRepository(Redemption).count()).toBe(3);
  });

  it('redeem hai lần cùng order_id → used_count tăng một lần, cùng số tiền', async () => {
    const c = await addCode({ code: 'SALE10', max_discount: 200_000 });
    const dto = order({ discount_code: 'SALE10' });

    const first = await service.redeem(dto);
    // Admin đổi mã giữa hai lần gọi: lần sau vẫn trả số tiền cũ
    await db.ds
      .getRepository(DiscountCode)
      .update(c.id, { discount_value: 50 });
    const second = await service.redeem(dto);

    expect(first.created).toBe(true);
    expect(second).toEqual({ created: false, redemption: first.redemption });
    expect(first.redemption.discount_amount).toBe(150_000);
    expect(await usedCount(c.id)).toBe(1);
  });

  it('redeem hai lần đồng thời cùng order_id → chỉ tăng một lần', async () => {
    const c = await addCode({ code: 'SALE10' });
    const dto = order({ discount_code: 'SALE10' });

    const [a, b] = await Promise.all([
      service.redeem(dto),
      service.redeem(dto),
    ]);

    expect([a.created, b.created].sort()).toEqual([false, true]);
    expect(a.redemption).toEqual(b.redemption);
    expect(await usedCount(c.id)).toBe(1);
  });

  it('mã thứ hai lỗi → mã thứ nhất không bị tăng lượt, không để lại dòng redemptions', async () => {
    const sale = await addCode({ code: 'SALE10' });
    await addCode({
      code: 'SHIP30',
      category: 'free_shipping',
      discount_type: 'fixed_amount',
      discount_value: 30_000,
      is_active: false,
    });
    const dto = order({ discount_code: 'SALE10', freeship_code: 'SHIP30' });

    await expect(service.redeem(dto)).rejects.toMatchObject({
      code: 'NT-PRM-1004',
    });
    expect(await usedCount(sale.id)).toBe(0);
    expect(await redemption(dto.order_id)).toBeNull();
  });

  it('release hai lần → giảm một lần (BR-07)', async () => {
    const sale = await addCode({ code: 'SALE10' });
    const ship = await addCode({
      code: 'SHIP30',
      category: 'free_shipping',
      discount_type: 'fixed_amount',
      discount_value: 30_000,
      used_count: 5,
    });
    const dto = order({ discount_code: 'SALE10', freeship_code: 'SHIP30' });
    await service.redeem(dto);

    const first = await service.release(dto.order_id);
    const second = await service.release(dto.order_id);

    expect(first).toEqual({ status: 'released', restored: true });
    expect(second).toEqual({ status: 'released', restored: false });
    expect(await usedCount(sale.id)).toBe(0);
    expect(await usedCount(ship.id)).toBe(5);
    expect(await redemption(dto.order_id)).toMatchObject({
      status: 'released',
      released_at: expect.any(Date) as Date,
    });
  });

  it('release trước, redeem sau → tombstone chặn, 409 NT-PRM-1008', async () => {
    const sale = await addCode({ code: 'SALE10' });
    const dto = order({ discount_code: 'SALE10' });

    await expect(service.release(dto.order_id)).resolves.toEqual({
      status: 'released',
      restored: false,
    });
    await expect(service.redeem(dto)).rejects.toMatchObject({
      code: 'NT-PRM-1008',
    });
    expect(await usedCount(sale.id)).toBe(0);
  });

  // release chạy khi redeem cùng order_id đang mở transaction, chưa commit (Component_Class_Design §4)
  describe('release chạy cùng redeem chưa commit', () => {
    async function redeemInFlight(orderId: string, codeId: string) {
      const qr = db.ds.createQueryRunner();
      await qr.connect();
      await qr.startTransaction();
      await qr.query(
        `INSERT INTO redemptions (order_id, status, discount_code_id) VALUES ($1, 'redeemed', $2)`,
        [orderId, codeId],
      );
      await qr.query(
        `UPDATE discount_codes SET used_count = used_count + 1 WHERE id = $1`,
        [codeId],
      );
      return qr;
    }

    async function isPending(p: Promise<unknown>, ms = 300) {
      const marker = Symbol('pending');
      const winner = await Promise.race([
        p.then(
          () => 'settled',
          () => 'settled',
        ),
        new Promise((r) => setTimeout(() => r(marker), ms)),
      ]);
      return winner === marker;
    }

    it('redeem commit → release chờ, rồi trả lượt (restored: true), không lỗi trùng khoá', async () => {
      const sale = await addCode({ code: 'SALE10' });
      const orderId = randomUUID();
      const qr = await redeemInFlight(orderId, sale.id);

      const releasing = service.release(orderId);
      expect(await isPending(releasing)).toBe(true);

      await qr.commitTransaction();
      await qr.release();

      await expect(releasing).resolves.toEqual({
        status: 'released',
        restored: true,
      });
      expect(await usedCount(sale.id)).toBe(0);
      expect(await redemption(orderId)).toMatchObject({ status: 'released' });
    });

    it('redeem rollback → release chèn tombstone (restored: false), không lỗi trùng khoá', async () => {
      const sale = await addCode({ code: 'SALE10' });
      const orderId = randomUUID();
      const qr = await redeemInFlight(orderId, sale.id);

      const releasing = service.release(orderId);
      expect(await isPending(releasing)).toBe(true);

      await qr.rollbackTransaction();
      await qr.release();

      await expect(releasing).resolves.toEqual({
        status: 'released',
        restored: false,
      });
      expect(await usedCount(sale.id)).toBe(0);
      expect(await redemption(orderId)).toMatchObject({ status: 'released' });
    });
  });
});
