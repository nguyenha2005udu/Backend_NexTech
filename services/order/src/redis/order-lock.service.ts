// Khoá đơn có thời hạn (BR-20, ADR-0015) — NT.ORDER_HOLD v1.3 Component_Class_Design §5, Processing_Flow §5.
// Redis xếp hàng sớm (chờ ≤ ORDER_LOCK_WAIT_MS, không chiếm kết nối Postgres khi chờ); FOR UPDATE + lock_timeout giữ
// độ đúng. Redis lỗi (đã lỗi nhanh nhờ client ở redis.module.ts) → chạy tiếp chỉ với khoá dòng (fail-open).
// Quy tắc: mỗi thao tác khoá một đơn, không lồng; không gọi HTTP trong fn; fn tự mở transaction bên trong.
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import type { OrderLockConfig } from '../config/configuration';
import { OrderLockBusyError, mapDbLockError } from '../database/db-lock-error';

export { OrderLockBusyError } from '../database/db-lock-error';

// Chỉ xoá khi token còn là của mình: lease đã hết hạn và bên khác đang giữ thì không xoá nhầm
const RELEASE_LUA = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`;

export interface OrderLockOptions {
  /** Chờ khoá Redis tối đa (ms). Mặc định ORDER_LOCK_WAIT_MS; 0 = thử một lần (poll, job) */
  waitMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

@Injectable()
export class OrderLockService {
  private readonly logger = new Logger(OrderLockService.name);
  private readonly cfg: OrderLockConfig;

  constructor(
    @Inject('ORDER_REDIS') private readonly redis: Redis,
    config: ConfigService,
  ) {
    this.cfg = config.getOrThrow<OrderLockConfig>('orderLock');
  }

  async withOrderLock<T>(
    orderId: string,
    fn: () => Promise<T>,
    opts: OrderLockOptions = {},
  ): Promise<T> {
    const key = `nt:order:lock:${orderId}`;
    const token = randomUUID();
    // Theo đồng hồ, không đếm số lần thử
    const deadlineAt = Date.now() + (opts.waitMs ?? this.cfg.waitMs);
    let held = false;
    let redisFailed = false;
    try {
      held = await this.acquire(key, token, deadlineAt);
    } catch (err) {
      redisFailed = true;
      this.logger.warn(
        `Redis lỗi khi khoá đơn ${orderId}, chạy tiếp chỉ với khoá dòng: ${(err as Error).message}`,
      );
    }
    // Bận thật, không phải Redis hỏng
    if (!held && !redisFailed) throw new OrderLockBusyError(orderId, 'redis');
    try {
      return await mapDbLockError(fn, orderId); // 55P03 → OrderLockBusyError
    } finally {
      if (held) await this.release(key, token, orderId);
    }
  }

  // SET NX PX; bận thì ngủ retryMs tới deadlineAt. Lỗi Redis ném ra để withOrderLock fail-open
  private async acquire(
    key: string,
    token: string,
    deadlineAt: number,
  ): Promise<boolean> {
    for (;;) {
      const ok = await this.redis.set(key, token, 'PX', this.cfg.ttlMs, 'NX');
      if (ok === 'OK') return true;
      const left = deadlineAt - Date.now();
      if (left <= 0) return false;
      await sleep(Math.min(this.cfg.retryMs, left));
    }
  }

  // Lỗi khi nhả thì bỏ qua: key tự hết hạn sau ttlMs
  private async release(key: string, token: string, orderId: string) {
    try {
      const n = await this.redis.eval(RELEASE_LUA, 1, key, token);
      if (n === 0) {
        this.logger.warn(
          `Khoá đơn ${orderId} đã hết hạn trước khi xong (lease ${this.cfg.ttlMs} ms)`,
        );
      }
    } catch {
      // key tự hết hạn
    }
  }
}
