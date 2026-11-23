import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { PayOS } from '@payos/node';
import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';
import type { CatalogClient } from '../../clients/catalog.client';
import type { PromotionClient } from '../../clients/promotion.client';
import type {
  HoldConfig,
  OrderLockConfig,
  RedisConfig,
} from '../../config/configuration';
import { Order } from '../../database/entities/order.entity';
import { Payment } from '../../database/entities/payment.entity';
import { SagaTask } from '../../database/entities/saga-task.entity';
import { OrderLockService } from '../../redis/order-lock.service';
import { createOrderRedis } from '../../redis/redis.module';
import { createTestDb, seedOrder, TestDb } from '../../test-helpers';
import { CheckoutSagaService } from '../checkout/checkout-saga.service';
import { CompensationService } from '../checkout/compensation.service';
import { OrderCancelService } from '../checkout/order-cancel.service';
import {
  HOLD_DUE_KEY,
  HoldScheduleService,
} from '../order-hold/hold-schedule.service';
import { PaymentCoreService } from '../payment/payment-core.service';
import { PaymentLedgerService } from '../payment/payment-ledger.service';
import { PaymentService } from '../payment/payment.service';
import { HoldExpiryJob } from './hold-expiry.job';
import { HoldExpiryService, type TickState } from './hold-expiry.service';

// POSTGRES + REDIS THẬT, PayOS/catalog/promotion giả.
// Chạy: docker compose up -d postgres redis && npm run test:int -w services/order -- hold-expiry
// NT.ORDER_HOLD v1.4 Component_Class_Design §7, §8, §11 test #8–#24 (BR-19, BR-10, BR-20); SRS AC-03…AC-12, AC-16.
// Hạn đặt về quá khứ bằng SQL thay vì chờ. Redis DB 15 riêng để không đụng hẹn của order đang chạy (DB 1).

jest.setTimeout(120_000);

const REDIS: RedisConfig = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: Number(process.env.REDIS_PORT ?? 6380),
  password: process.env.REDIS_PASSWORD || undefined,
  tls: false,
  db: 15,
  commandTimeoutMs: 200,
  connectTimeoutMs: 1000,
};
const HOLD: HoldConfig = {
  ttlMs: 15 * 60_000,
  graceMs: 1_000,
  sweepIntervalMs: 15_000,
  dbSweepEvery: 3,
  batch: 100,
  deferBackoffMs: 60_000,
  maxDeferMs: 10 * 60_000,
};
const LOCK: OrderLockConfig = { ttlMs: 10_000, waitMs: 2_000, retryMs: 20 };
const PAYOS_CFG = {
  clientId: 'dev',
  apiKey: 'dev',
  checksumKey: 'dev-checksum',
  returnUrl: 'http://r',
  cancelUrl: 'http://c',
  timeoutMs: 5000,
};
const MIN = 60_000;

const cfg = (o: Record<string, unknown>) =>
  ({ getOrThrow: (k: string) => o[k] }) as unknown as ConfigService;

describe('HoldExpiryService, HoldExpiryJob (Postgres + Redis thật)', () => {
  let db: TestDb;
  let redis: Redis;
  let hold: HoldScheduleService;
  let lock: OrderLockService;
  let core: PaymentCoreService;
  let cancel: OrderCancelService;
  let payments: PaymentService;
  let svc: HoldExpiryService;
  const payos = { paymentRequests: { get: jest.fn(), create: jest.fn() } };
  const catalog = { release: jest.fn(), reserve: jest.fn() };
  const promotion = { release: jest.fn() };
  const config = cfg({
    hold: HOLD,
    orderLock: LOCK,
    checkout: { budgetMs: 8000 },
    payos: PAYOS_CFG,
  });

  const makeService = (holdCfg: HoldConfig = HOLD) =>
    new HoldExpiryService(
      db.ds.getRepository(Order),
      db.ds.getRepository(Payment),
      db.ds,
      payos as unknown as PayOS,
      core,
      cancel,
      lock,
      hold,
      cfg({ hold: holdCfg }),
    );

  beforeAll(async () => {
    db = await createTestDb();
    redis = createOrderRedis(REDIS);
    await new Promise((r) => redis.once('ready', r));
    hold = new HoldScheduleService(redis, config);
    lock = new OrderLockService(redis, config);
    const ledger = new PaymentLedgerService(db.ds);
    core = new PaymentCoreService(db.ds, ledger, lock, hold);
    const compensation = new CompensationService(
      db.ds.getRepository(Order),
      db.ds.getRepository(SagaTask),
      db.ds,
      catalog as unknown as CatalogClient,
      promotion as unknown as PromotionClient,
    );
    cancel = new OrderCancelService(
      db.ds,
      compensation,
      core,
      config,
      lock,
      hold,
    );
    payments = new PaymentService(
      db.ds.getRepository(Order),
      db.ds.getRepository(Payment),
      db.ds,
      payos as unknown as PayOS,
      core,
      config,
      hold,
    );
    svc = makeService();
  });
  afterAll(async () => {
    await redis?.quit();
    await db?.cleanup();
  });
  beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    await db.ds.query('TRUNCATE orders CASCADE');
    await redis.del(HOLD_DUE_KEY);
    catalog.release.mockResolvedValue({ status: 'released', restored: true });
    promotion.release.mockResolvedValue({ status: 'released', restored: true });
    payos.paymentRequests.get.mockResolvedValue({ status: 'PENDING' });
    svc.deferUntil.clear();
  });
  afterEach(() => jest.restoreAllMocks());

  /** Đơn pending đã xác nhận; hạn = now + offsetMs (âm: đã quá hạn); hẹn trong Redis. Kèm giao dịch nếu có */
  async function order(
    o: {
      offsetMs?: number;
      userId?: string;
      discount?: string;
      pay?: { method: 'payos' | 'cod'; status?: string; code?: string | null };
      status?: string;
      schedule?: boolean;
    } = {},
  ) {
    const userId = o.userId ?? randomUUID();
    const expiresAt = new Date(Date.now() + (o.offsetMs ?? -2 * MIN));
    const id = await seedOrder(db.ds, {
      user_id: userId,
      status: o.status ?? 'pending',
      payment_expires_at: expiresAt,
    });
    await db.ds.query(
      `UPDATE orders SET saga_step = 'confirmed', discount_code = $2 WHERE id = $1`,
      [id, o.discount ?? null],
    );
    let paymentId: string | undefined;
    if (o.pay) {
      const [p] = await db.ds.query<Array<{ id: string }>>(
        `INSERT INTO payments (order_id, method, transaction_id, amount, status)
         VALUES ($1, $2, $3, 230000, $4) RETURNING id`,
        [
          id,
          o.pay.method,
          o.pay.code === undefined
            ? o.pay.method === 'payos'
              ? String(Math.floor(Math.random() * 1e9))
              : null
            : o.pay.code,
          o.pay.status ?? 'pending',
        ],
      );
      paymentId = p.id;
    }
    if (o.schedule !== false) await hold.schedule(id, expiresAt);
    return { id, userId, paymentId, expiresAt };
  }
  const orderRow = (id: string) =>
    db.ds.getRepository(Order).findOneByOrFail({ id });
  const paymentRow = (id: string) =>
    db.ds.getRepository(Payment).findOneByOrFail({ id });
  const score = (id: string) => redis.zscore(HOLD_DUE_KEY, id);
  const tasksOf = (id: string) =>
    db.ds.query<Array<{ type: string; seq: number; status: string }>>(
      'SELECT type, seq, status FROM saga_tasks WHERE order_id = $1 ORDER BY seq',
      [id],
    );
  const tick = (): TickState => ({ payosDown: false });
  const makeJob = (h: Pick<HoldScheduleService, 'due'> = hold, s = svc) =>
    new HoldExpiryJob(s, h as HoldScheduleService, db.ds, cfg({ hold: HOLD }));

  it('#24, #8 đơn xác nhận qua cron đối soát (tạo từ 1 giờ trước) → hạn = lúc xác nhận + 15 phút, có hẹn Redis', async () => {
    const id = await seedOrder(db.ds, {
      user_id: randomUUID(),
      status: 'processing',
      created_at: new Date(Date.now() - 60 * MIN),
      lines: [{ quantity: 1, unit_price: 200000 }],
    });
    await db.ds.query(
      `UPDATE orders SET saga_step = 'stock_reserved' WHERE id = $1`,
      [id],
    );
    const saga = new CheckoutSagaService(
      db.ds.getRepository(Order),
      db.ds,
      catalog as unknown as CatalogClient,
      promotion as unknown as PromotionClient,
      {} as CompensationService,
      hold,
    );
    const loaded = await db.ds
      .getRepository(Order)
      .findOneOrFail({ where: { id }, relations: { items: true } });
    const t0 = Date.now();
    const out = await saga.advance(loaded); // như ReconcileJob: không deadline
    const o = await orderRow(id);
    expect(out.kind).toBe('confirmed');
    expect(o.status).toBe('pending');
    const exp = o.payment_expires_at!.getTime();
    expect(exp).toBeGreaterThanOrEqual(t0 + 15 * MIN - 1000);
    expect(exp).toBeLessThanOrEqual(Date.now() + 15 * MIN + 1000);
    expect(Number(await score(id))).toBe(exp);
  });

  it('#9 đơn quá hạn + ân hạn, chưa thanh toán → huỷ bởi system: saga_tasks nhả mã rồi kho, gỡ hẹn (AC-04)', async () => {
    const o = await order({ discount: 'SALE10' });
    const calls: string[] = [];
    promotion.release.mockImplementation(() => {
      calls.push('promotion');
      return Promise.resolve({ status: 'released', restored: true });
    });
    catalog.release.mockImplementation(() => {
      calls.push('catalog');
      return Promise.resolve({ status: 'released', restored: true });
    });
    expect(await svc.expireOne(o.id, tick())).toBe('cancelled');
    expect((await orderRow(o.id)).status).toBe('cancelled');
    expect(await tasksOf(o.id)).toEqual([
      { type: 'release_promotion', seq: 1, status: 'done' },
      { type: 'release_stock', seq: 2, status: 'done' },
    ]);
    expect(calls).toEqual(['promotion', 'catalog']);
    expect(await score(o.id)).toBeNull();
  });

  it('chưa qua ân hạn → không huỷ, hẹn lại đúng hạn', async () => {
    const o = await order({ offsetMs: -200 }); // quá hạn 0,2 s < ân hạn 1 s
    expect(await svc.expireOne(o.id, tick())).toBe('skipped');
    expect((await orderRow(o.id)).status).toBe('pending');
    expect(Number(await score(o.id))).toBe(o.expiresAt.getTime());
  });

  it('#10 chọn COD trước hạn → payment_expires_at NULL, gỡ hẹn; job không huỷ (AC-05)', async () => {
    const o = await order({ offsetMs: 5 * MIN });
    await payments.create(o.userId, { order_id: o.id, method: 'cod' });
    expect(await score(o.id)).toBeNull();
    expect((await orderRow(o.id)).payment_expires_at).toBeNull();
    expect(await svc.expireOne(o.id, tick())).toBe('skipped');
    expect((await orderRow(o.id)).status).toBe('pending');
  });

  it('#11 trả PayOS trước hạn → paid, gỡ hẹn; job không đổi đơn (AC-06)', async () => {
    const o = await order({ offsetMs: 5 * MIN, pay: { method: 'payos' } });
    await core.markSuccess({ paymentId: o.paymentId, paidAmount: 230000 });
    expect(await score(o.id)).toBeNull();
    expect(await svc.expireOne(o.id, tick())).toBe('skipped');
    expect((await orderRow(o.id)).status).toBe('paid');
  });

  it('#12 quá hạn, PayOS báo PAID khi job hỏi → paid, không huỷ (AC-08)', async () => {
    const o = await order({ pay: { method: 'payos' } });
    payos.paymentRequests.get.mockResolvedValue({
      status: 'PAID',
      amountPaid: 230000,
    });
    expect(await svc.expireOne(o.id, tick())).toBe('paid');
    expect((await orderRow(o.id)).status).toBe('paid');
    expect((await paymentRow(o.paymentId!)).status).toBe('success');
    expect(await score(o.id)).toBeNull();
  });

  it('#13 PayOS báo PAID nhưng ghi nhận lỗi (sai tiền; khoá bận), kể cả quá MAX_DEFER → KHÔNG BAO GIỜ huỷ (AC-16)', async () => {
    const o = await order({ offsetMs: -30 * MIN, pay: { method: 'payos' } }); // quá hạn hoãn tối đa
    payos.paymentRequests.get.mockResolvedValue({
      status: 'PAID',
      amountPaid: 1,
    });
    for (let i = 0; i < 3; i++) {
      await expect(svc.expireOne(o.id, tick())).rejects.toMatchObject({
        code: 'NT-PAY-1005',
      });
    }
    expect((await orderRow(o.id)).status).toBe('pending');

    payos.paymentRequests.get.mockResolvedValue({
      status: 'PAID',
      amountPaid: 230000,
    });
    await redis.set(`nt:order:lock:${o.id}`, 'other', 'PX', 10_000);
    expect(await svc.expireOne(o.id, tick())).toBe('deferred');
    await redis.del(`nt:order:lock:${o.id}`);
    expect((await orderRow(o.id)).status).toBe('pending');
    expect(svc.deferUntil.has(o.id)).toBe(true);
  });

  it('#14 PayOS lỗi → hoãn (lùi điểm Redis); quá ORDER_HOLD_MAX_DEFER_MS → huỷ', async () => {
    payos.paymentRequests.get.mockRejectedValue(new Error('timeout'));
    const a = await order({ pay: { method: 'payos' } });
    const t = tick();
    expect(await svc.expireOne(a.id, t)).toBe('deferred');
    expect(t.payosDown).toBe(true);
    expect(Number(await score(a.id))).toBeGreaterThan(Date.now() + 50_000);
    expect((await orderRow(a.id)).status).toBe('pending');

    const b = await order({ offsetMs: -11 * MIN, pay: { method: 'payos' } });
    expect(await svc.expireOne(b.id, tick())).toBe('cancelled');
    expect((await orderRow(b.id)).status).toBe('cancelled');
    expect((await paymentRow(b.paymentId!)).status).toBe('failed');
  });

  it('#15 PayOS lỗi + 60 đơn PayOS quá hạn + 1 đơn thường → cả lượt gọi PayOS 1 lần, đơn thường vẫn huỷ (NFR-ORD-05)', async () => {
    payos.paymentRequests.get.mockRejectedValue(new Error('timeout'));
    for (let i = 0; i < 60; i++) {
      await order({ offsetMs: -3 * MIN, pay: { method: 'payos' } });
    }
    const plain = await order({ offsetMs: -2 * MIN });
    await makeJob().tick();
    expect(payos.paymentRequests.get).toHaveBeenCalledTimes(1);
    expect((await orderRow(plain.id)).status).toBe('cancelled');
    const [{ n }] = await db.ds.query<Array<{ n: string }>>(
      `SELECT count(*) n FROM orders WHERE status = 'pending'`,
    );
    expect(Number(n)).toBe(60);
  });

  it('#16 job và webhook PAID cùng lúc → đúng một nhánh: paid, hoặc cancelled + needs_refund (BR-10) — 5 vòng', async () => {
    for (let i = 0; i < 5; i++) {
      const o = await order({ pay: { method: 'payos' } });
      await Promise.allSettled([
        svc.expireOne(o.id, tick()),
        core.markSuccess({ paymentId: o.paymentId, paidAmount: 230000 }),
      ]);
      const ord = await orderRow(o.id);
      const pay = await paymentRow(o.paymentId!);
      expect(pay.status).toBe('success'); // tiền về luôn được ghi nhận
      if (ord.status === 'paid') expect(pay.needs_refund).toBe(false);
      else {
        expect(ord.status).toBe('cancelled');
        expect(pay.needs_refund).toBe(true);
      }
    }
  });

  it('#17 job và người mua huỷ cùng lúc → một lần huỷ, kho nhả một lần (AC-12)', async () => {
    for (let i = 0; i < 5; i++) {
      const o = await order();
      await Promise.allSettled([
        svc.expireOne(o.id, tick()),
        cancel.cancelByUser(o.userId, o.id),
      ]);
      expect((await orderRow(o.id)).status).toBe('cancelled');
      expect(await tasksOf(o.id)).toHaveLength(1);
    }
    expect(catalog.release).toHaveBeenCalledTimes(5);
  });

  it('#18 job và tạo COD cùng lúc (Postgres thật) → đúng một nhánh: COD + không huỷ, hoặc cancelled + 400 NT-PAY-1002', async () => {
    // Ân hạn âm để job coi đơn tới hạn khi tạo giao dịch còn hợp lệ: buộc hai bên đua đúng ở UPDATE có điều kiện
    const racer = makeService({ ...HOLD, graceMs: -60_000 });
    for (let i = 0; i < 6; i++) {
      const o = await order({ offsetMs: 30_000 });
      const [job, cod] = await Promise.allSettled([
        racer.expireOne(o.id, tick()),
        payments.create(o.userId, { order_id: o.id, method: 'cod' }),
      ]);
      const ord = await orderRow(o.id);
      if (cod.status === 'fulfilled') {
        expect(ord.status).toBe('pending');
        expect(ord.payment_expires_at).toBeNull();
        expect(job).toMatchObject({ status: 'fulfilled' });
        expect((job as PromiseFulfilledResult<string>).value).not.toBe(
          'cancelled',
        );
      } else {
        expect(ord.status).toBe('cancelled');
        expect(cod.reason).toMatchObject({ status: 400, code: 'NT-PAY-1002' });
      }
    }
  });

  it('#19 tạo giao dịch sau hạn, job chưa chạy → 400 NT-PAY-1010 (AC-07)', async () => {
    const o = await order({ offsetMs: -10_000 });
    await expect(
      payments.create(o.userId, { order_id: o.id, method: 'cod' }),
    ).rejects.toMatchObject({ status: 400, code: 'NT-PAY-1010' });
  });

  it('#20 Redis mất mục → lượt quét DB thứ ORDER_HOLD_DB_SWEEP_EVERY vẫn huỷ', async () => {
    const o = await order({ schedule: false });
    const job = makeJob();
    await job.tick();
    await job.tick();
    expect((await orderRow(o.id)).status).toBe('pending');
    await job.tick(); // lượt 3 = dbSweepEvery
    expect((await orderRow(o.id)).status).toBe('cancelled');
  });

  it('#21 Redis lỗi → mỗi lượt quét DB, đơn quá hạn huỷ ngay lượt đầu (AC-11)', async () => {
    const o = await order({ schedule: false });
    const down = { due: () => Promise.reject(new Error('Redis down')) };
    await makeJob(down).tick();
    expect((await orderRow(o.id)).status).toBe('cancelled');
  });

  it('#22 hai bản sao job cùng chạy → mỗi đơn huỷ đúng một lần', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await order()).id);
    const other = makeService();
    await Promise.all([makeJob().tick(), makeJob(hold, other).tick()]);
    for (const id of ids) {
      expect((await orderRow(id)).status).toBe('cancelled');
      expect(await tasksOf(id)).toHaveLength(1);
    }
    expect(catalog.release).toHaveBeenCalledTimes(5);
  });

  it('#23 mục Redis của đơn đã paid → gỡ mục, không đổi đơn', async () => {
    const o = await order({ status: 'paid' });
    expect(await svc.expireOne(o.id, tick())).toBe('skipped');
    expect((await orderRow(o.id)).status).toBe('paid');
    expect(await score(o.id)).toBeNull();
  });

  it('dueFromDb bỏ qua đơn đang hoãn (deferUntil), lấy theo hạn sớm nhất', async () => {
    const a = await order({ offsetMs: -5 * MIN, schedule: false });
    const b = await order({ offsetMs: -3 * MIN, schedule: false });
    const job = makeJob();
    expect(await job.dueFromDb(10, [])).toEqual([a.id, b.id]);
    expect(await job.dueFromDb(10, [a.id])).toEqual([b.id]);
  });
});
