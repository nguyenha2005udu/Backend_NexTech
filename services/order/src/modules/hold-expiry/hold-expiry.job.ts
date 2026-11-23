// Job huỷ đơn quá hạn giữ hàng (BR-19, NT.ORDER_HOLD v1.4 Component_Class_Design §8). Danh sách lấy từ sorted set
// Redis; Redis lỗi thì quét DB mỗi lượt, Redis sống thì cứ ORDER_HOLD_DB_SWEEP_EVERY lượt quét DB một lần (phòng mất
// mục). Lỗi một đơn không dừng đơn khác. Không tắt theo RESILIENCE_ENABLED: đây là luật nghiệp vụ, không phải cơ chế
// chịu lỗi (duyệt 23-11-2026). Nhiều bản sao chạy cùng lúc vẫn đúng: FOR UPDATE + kiểm lại hạn trong expireOne.
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { type HoldConfig, holdConfig } from '../../config/configuration';
import { HoldScheduleService } from '../order-hold/hold-schedule.service';
import { HoldExpiryService, type TickState } from './hold-expiry.service';

@Injectable()
export class HoldExpiryJob {
  private readonly logger = new Logger(HoldExpiryJob.name);
  private readonly cfg: HoldConfig;
  private running = false;
  private n = 0;

  constructor(
    private readonly service: HoldExpiryService,
    private readonly hold: HoldScheduleService,
    private readonly ds: DataSource,
    config: ConfigService,
  ) {
    this.cfg = config.getOrThrow<HoldConfig>('hold');
  }

  // Chu kỳ đọc từ env lúc nạp module, như ReconcileJob
  @Interval('order-hold-expiry', holdConfig().sweepIntervalMs)
  async tick(): Promise<void> {
    if (this.running) return; // lượt trước chưa xong
    this.running = true;
    const tick: TickState = { payosDown: false };
    try {
      this.n++;
      this.service.pruneDeferred();
      let ids: string[] = [];
      let redisOk = true;
      try {
        ids = await this.hold.due(this.cfg.batch);
      } catch {
        redisOk = false;
      }
      if (!redisOk || this.n % this.cfg.dbSweepEvery === 0) {
        const fromDb = await this.dueFromDb(this.cfg.batch, [
          ...this.service.deferUntil.keys(),
        ]);
        ids = [...new Set([...ids, ...fromDb])];
      }
      for (const id of ids) {
        try {
          await this.service.expireOne(id, tick);
        } catch (e) {
          this.logger.error(
            `Huỷ quá hạn đơn ${id} lỗi: ${(e as Error).message}`,
          );
        }
      }
    } catch (e) {
      this.logger.error(`Lượt huỷ quá hạn lỗi: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** Đơn pending quá hạn + ân hạn theo DB (index ix_orders_hold_due), trừ đơn đang hoãn; hạn sớm nhất trước */
  async dueFromDb(limit: number, excludeIds: string[]): Promise<string[]> {
    const rows = await this.ds.query<Array<{ id: string }>>(
      `SELECT id FROM orders
       WHERE status = 'pending' AND payment_expires_at IS NOT NULL
         AND payment_expires_at <= now() - ($1 * interval '1 millisecond')
         AND NOT (id = ANY($2::uuid[]))
       ORDER BY payment_expires_at
       LIMIT $3`,
      [this.cfg.graceMs, excludeIds, limit],
    );
    return rows.map((r) => r.id);
  }
}
