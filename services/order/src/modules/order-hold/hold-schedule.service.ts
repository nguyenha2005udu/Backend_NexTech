// Hẹn hạn giữ hàng trong Redis (BR-19, NT.ORDER_HOLD v1.4 Component_Class_Design §6). Module LÁ: chỉ phụ thuộc
// client Redis và config, để checkout, payment, admin-order, hold-expiry cùng import mà không vòng.
// Sorted set nt:order:hold:due: member = orderId, score = hạn xử lý kế tiếp (epoch ms). Redis chỉ là lịch hẹn cho
// nhanh; nguồn sự thật là orders.payment_expires_at — mất mục thì HoldExpiryJob quét DB bù (§8).
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import type { HoldConfig } from '../../config/configuration';
import { ORDER_REDIS } from '../../redis/redis.module';

export const HOLD_DUE_KEY = 'nt:order:hold:due';

@Injectable()
export class HoldScheduleService {
  private readonly logger = new Logger(HoldScheduleService.name);
  private readonly cfg: HoldConfig;

  constructor(
    @Inject(ORDER_REDIS) private readonly redis: Redis,
    config: ConfigService,
  ) {
    this.cfg = config.getOrThrow<HoldConfig>('hold');
  }

  /** Hạn giữ hàng tính từ lúc saga xác nhận đơn */
  deadlineFrom(now = new Date()): Date {
    return new Date(now.getTime() + this.cfg.ttlMs);
  }

  schedule(orderId: string, expiresAt: Date): Promise<void> {
    return this.safe('hẹn', orderId, () =>
      this.redis.zadd(HOLD_DUE_KEY, expiresAt.getTime(), orderId),
    );
  }

  unschedule(orderId: string): Promise<void> {
    return this.safe('gỡ hẹn', orderId, () =>
      this.redis.zrem(HOLD_DUE_KEY, orderId),
    );
  }

  /** Hoãn: lùi điểm để đơn không chiếm đầu danh sách mỗi lượt */
  defer(orderId: string, untilMs: number): Promise<void> {
    return this.safe('hoãn', orderId, () =>
      this.redis.zadd(HOLD_DUE_KEY, untilMs, orderId),
    );
  }

  /** Đơn tới lượt xử lý (hạn + ân hạn đã qua). Redis lỗi thì NÉM để job biết mà quét DB */
  due(limit: number): Promise<string[]> {
    return this.redis.zrangebyscore(
      HOLD_DUE_KEY,
      '-inf',
      Date.now() - this.cfg.graceMs,
      'LIMIT',
      0,
      limit,
    );
  }

  // Lỗi Redis (đã lỗi nhanh nhờ client ở redis.module.ts) không làm hỏng request: log và bỏ qua
  private async safe(
    action: string,
    orderId: string,
    fn: () => Promise<unknown>,
  ): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.logger.warn(
        `Redis lỗi khi ${action} đơn ${orderId}: ${(err as Error).message}`,
      );
    }
  }
}
