import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:net';
import type Redis from 'ioredis';
import type { OrderLockConfig, RedisConfig } from '../config/configuration';
import { OrderLockBusyError } from '../database/db-lock-error';
import { appConnectionExtra } from '../database/typeorm-options';
import { createTestDb, seedOrder, TestDb } from '../test-helpers';
import { OrderLockService } from './order-lock.service';
import { createOrderRedis } from './redis.module';

// REDIS + POSTGRES THẬT. Chạy: docker compose up -d redis postgres && npm run test:int -w services/order -- order-lock
// NT.ORDER_HOLD v1.3 Component_Class_Design §11 test #1–#7 (BR-20, ADR-0015), §2 client lỗi nhanh, §9 lock_timeout.
// Thời gian rút ngắn (wait/ttl 300 ms) để test nhanh; tỉ lệ giữa các mốc giữ như cấu hình thật.

jest.setTimeout(60_000);

const REDIS: RedisConfig = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: Number(process.env.REDIS_PORT ?? 6380),
  password: process.env.REDIS_PASSWORD || undefined,
  tls: false,
  db: 1,
  commandTimeoutMs: 200,
  connectTimeoutMs: 1000,
};
const LOCK: OrderLockConfig = { ttlMs: 10_000, waitMs: 300, retryMs: 20 };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const cfgOf = (lock: OrderLockConfig) =>
  ({ getOrThrow: () => lock }) as unknown as ConfigService;

describe('OrderLockService (Redis thật)', () => {
  let redis: Redis;
  let svc: OrderLockService;

  beforeAll(async () => {
    redis = createOrderRedis(REDIS);
    // enableOfflineQueue: false → lệnh trước khi 'ready' lỗi ngay (fail-open); test cần Redis đã sẵn sàng
    await new Promise((r) => redis.once('ready', r));
    svc = new OrderLockService(redis, cfgOf(LOCK));
  });
  afterAll(() => redis.quit());

  it('#1 hai lời gọi song song cùng đơn, fn 200 ms → tuần tự, không chồng', async () => {
    const id = randomUUID();
    const spans: Array<[number, number]> = [];
    const job = () =>
      svc.withOrderLock(
        id,
        async () => {
          const s = Date.now();
          await sleep(200);
          spans.push([s, Date.now()]);
        },
        { waitMs: 1000 },
      );
    await Promise.all([job(), job()]);
    spans.sort((a, b) => a[0] - b[0]);
    expect(spans).toHaveLength(2);
    expect(spans[1][0]).toBeGreaterThanOrEqual(spans[0][1]);
    expect(await redis.exists(`nt:order:lock:${id}`)).toBe(0); // đã nhả
  });

  it('#2 bên giữ lâu hơn ORDER_LOCK_WAIT_MS → bên chờ OrderLockBusyError sau ≈ waitMs (đo đồng hồ)', async () => {
    const id = randomUUID();
    const holder = svc.withOrderLock(id, () => sleep(800));
    await sleep(20);
    const t0 = Date.now();
    const fn = jest.fn();
    const err = await svc.withOrderLock(id, fn).catch((e: unknown) => e);
    const waited = Date.now() - t0;
    await holder;
    expect(err).toBeInstanceOf(OrderLockBusyError);
    expect(fn).not.toHaveBeenCalled();
    expect(waited).toBeGreaterThanOrEqual(LOCK.waitMs - 5);
    expect(waited).toBeLessThan(LOCK.waitMs + 200);
  });

  it('waitMs 0 → thử một lần, bận thì báo ngay', async () => {
    const id = randomUUID();
    const holder = svc.withOrderLock(id, () => sleep(300));
    await sleep(20);
    const t0 = Date.now();
    const err = await svc
      .withOrderLock(id, () => Promise.resolve(), { waitMs: 0 })
      .catch((e: unknown) => e);
    expect(Date.now() - t0).toBeLessThan(100);
    await holder;
    expect(err).toBeInstanceOf(OrderLockBusyError);
  });

  it('#3 fn quá ORDER_LOCK_TTL_MS → bên khác lấy được; bên cũ nhả không xoá khoá mới, log warn', async () => {
    const short = new OrderLockService(redis, cfgOf({ ...LOCK, ttlMs: 300 }));
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const id = randomUUID();
    const key = `nt:order:lock:${id}`;
    const a = short.withOrderLock(id, () => sleep(600)); // lease hết hạn ở 300 ms
    await sleep(400);
    let keyWhileB: number | undefined;
    const b = svc.withOrderLock(
      id,
      async () => {
        await sleep(400); // A kết thúc và nhả trong lúc B còn giữ (B lease 10 s)
        keyWhileB = await redis.exists(key);
      },
      { waitMs: 0 },
    );
    await Promise.all([a, b]);
    expect(keyWhileB).toBe(1); // A không xoá khoá của B
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('hết hạn'));
    warn.mockRestore();
  });

  it('khoá khác đơn không chặn nhau', async () => {
    const t0 = Date.now();
    await Promise.all([
      svc.withOrderLock(randomUUID(), () => sleep(200)),
      svc.withOrderLock(randomUUID(), () => sleep(200)),
    ]);
    expect(Date.now() - t0).toBeLessThan(380);
  });

  it('fn ném lỗi → vẫn nhả khoá, lỗi truyền nguyên', async () => {
    const id = randomUUID();
    const boom = new Error('boom');
    await expect(
      svc.withOrderLock(id, () => Promise.reject(boom)),
    ).rejects.toBe(boom);
    expect(await redis.exists(`nt:order:lock:${id}`)).toBe(0);
  });
});

describe('OrderLockService khi Redis lỗi (fail-open, ADR-0015)', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });
  afterEach(() => warn.mockRestore());

  it('#4 Redis chết (cổng đóng) → fn vẫn chạy, thêm ≤ 3 × REDIS_COMMAND_TIMEOUT_MS', async () => {
    const dead = createOrderRedis({ ...REDIS, host: '127.0.0.1', port: 6399 });
    dead.on('error', () => undefined);
    const svc = new OrderLockService(dead, cfgOf(LOCK));
    const t0 = Date.now();
    const r = await svc.withOrderLock(randomUUID(), () =>
      Promise.resolve('ok'),
    );
    const extra = Date.now() - t0;
    dead.disconnect();
    expect(r).toBe('ok');
    expect(extra).toBeLessThanOrEqual(3 * REDIS.commandTimeoutMs);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Redis lỗi'));
  });

  it('#5 Redis treo (nhận kết nối, không trả lời — như docker pause) → fn vẫn chạy, thêm ≤ 600 ms', async () => {
    const sockets: Array<{ destroy(): void }> = [];
    const server: Server = createServer((s) => sockets.push(s)); // không bao giờ trả lời
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    const hung = createOrderRedis({ ...REDIS, host: '127.0.0.1', port });
    hung.on('error', () => undefined);
    await sleep(100); // đã mở TCP, đang chờ trả lời
    const svc = new OrderLockService(hung, cfgOf(LOCK));
    const t0 = Date.now();
    const r = await svc.withOrderLock(randomUUID(), () =>
      Promise.resolve('ok'),
    );
    const extra = Date.now() - t0;
    hung.disconnect();
    sockets.forEach((s) => s.destroy());
    await new Promise((r) => server.close(r));
    expect(r).toBe('ok');
    expect(extra).toBeLessThanOrEqual(600);
  });
});

describe('Khoá dòng Postgres: lock_timeout, idle_in_transaction (Postgres thật)', () => {
  let db: TestDb;
  // Như kết nối ứng dụng (appConnectionExtra) nhưng rút ngắn để test nhanh
  const PG = appConnectionExtra({
    DB_LOCK_TIMEOUT_MS: '300',
    DB_IDLE_TX_TIMEOUT_MS: '500',
  }).options;

  beforeAll(async () => {
    db = await createTestDb({ pgOptions: PG });
  });
  afterAll(async () => db?.cleanup());

  it('appConnectionExtra mặc định đặt lock_timeout 1 s, idle 15 s; Postgres nhận đúng (SHOW)', async () => {
    expect(appConnectionExtra({}).options).toBe(
      '-c lock_timeout=1000 -c idle_in_transaction_session_timeout=15000',
    );
    const [{ lock_timeout }] =
      await db.ds.query<Array<{ lock_timeout: string }>>('SHOW lock_timeout');
    const [{ idle_in_transaction_session_timeout: idle }] = await db.ds.query<
      Array<{ idle_in_transaction_session_timeout: string }>
    >('SHOW idle_in_transaction_session_timeout');
    expect(lock_timeout).toBe('300ms');
    expect(idle).toBe('500ms');
  });

  it('#6 A giữ FOR UPDATE quá DB_LOCK_TIMEOUT_MS, B cùng đơn (bỏ qua Redis) → OrderLockBusyError (55P03)', async () => {
    const id = await seedOrder(db.ds, {
      user_id: randomUUID(),
      status: 'pending',
    });
    const noRedis = new OrderLockService(
      { set: () => Promise.reject(new Error('down')) } as unknown as Redis,
      cfgOf(LOCK),
    );
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const a = db.ds.transaction(async (m) => {
      await m.query('SELECT id FROM orders WHERE id = $1 FOR UPDATE', [id]);
      await sleep(450); // < idle 500 ms, > lock_timeout 300 ms
    });
    await sleep(50);
    const t0 = Date.now();
    const err = await noRedis
      .withOrderLock(id, () =>
        db.ds.transaction((m) =>
          m.query<unknown[]>('SELECT id FROM orders WHERE id = $1 FOR UPDATE', [
            id,
          ]),
        ),
      )
      .catch((e: unknown) => e);
    const waited = Date.now() - t0;
    await a;
    warn.mockRestore();
    expect(err).toBeInstanceOf(OrderLockBusyError);
    expect((err as OrderLockBusyError).source).toBe('db');
    expect(waited).toBeLessThan(600);
  });

  it('#7 transaction mở rồi bỏ dở > idle timeout → Postgres cắt phiên, khoá dòng được nhả', async () => {
    const id = await seedOrder(db.ds, {
      user_id: randomUUID(),
      status: 'pending',
    });
    const qr = db.ds.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    await qr.query('SELECT id FROM orders WHERE id = $1 FOR UPDATE', [id]);
    await sleep(900); // > 500 ms idle → phiên bị cắt
    const rows = await db.ds.transaction((m) =>
      m.query<unknown[]>('SELECT id FROM orders WHERE id = $1 FOR UPDATE', [
        id,
      ]),
    );
    expect(rows).toHaveLength(1);
    await qr.query('SELECT 1').catch(() => undefined); // phiên đã chết
    await qr.release().catch(() => undefined);
  });
});
