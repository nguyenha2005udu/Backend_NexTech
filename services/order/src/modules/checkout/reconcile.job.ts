// Cron đối soát saga (NT.CHECKOUT_SAGA Component_Class_Design §7 v1.7, Processing_Flow §3–4). Mới, không có
// trong be/: be/ một transaction nên không có đơn dở dang (source-of-truth §2: transaction chung → saga).
// Mỗi tick: (1) làm tiếp đơn processing kẹt, quá saga_deadline thì hoàn tác; (2) chạy saga_tasks còn tồn
// (saga thất bại, huỷ đơn); (3) chốt failed cho đơn compensating đã hết task. Tắt khi RESILIENCE_ENABLED=false.
// Chạy lại bao nhiêu lần cũng an toàn: advance, startForFailedSaga, finish đều UPDATE có điều kiện, lệnh nhả
// idempotent.
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import {
  checkoutConfig,
  type CheckoutConfig,
} from '../../config/configuration';
import { Order } from '../../database/entities/order.entity';
import { OrderItem } from '../../database/entities/order-item.entity';
import { CheckoutSagaService } from './checkout-saga.service';
import { CompensationService } from './compensation.service';
import { timeoutError } from './saga.types';

// Mỗi bước tối đa 50 đơn (Component_Class_Design §7)
const BATCH = 50;
// Tuổi tối thiểu để đối soát: lớn hơn ngân sách request 8 s, tránh đua với request đang chạy (API_Spec §5)
const MIN_AGE_MS = 15_000;

// Truy vấn thô: QueryBuilder không dựng được UPDATE + câu con LIMIT + FOR UPDATE SKIP LOCKED (mẫu cron theo
// dõi giá của catalog). Vừa chọn vừa đặt lại updated_at: đơn chưa rõ không bị thử lại ở mọi tick, hai lượt
// chạy chồng (hoặc hai bản order) lấy lô khác nhau. updated_at là timestamp không múi giờ → LOCALTIMESTAMP.
// Index: ix_orders_processing (updated_at) WHERE status = 'processing'.
const CLAIM_STUCK_SQL = `
  UPDATE orders SET updated_at = LOCALTIMESTAMP
  WHERE id IN (
    SELECT id FROM orders
    WHERE status = 'processing' AND saga_step <> 'compensating'
      AND updated_at < LOCALTIMESTAMP - $1::int * interval '1 millisecond'
    ORDER BY updated_at
    LIMIT $2::int
    FOR UPDATE SKIP LOCKED)
  RETURNING *`;

// Index: ix_saga_tasks_pending (order_id, seq) WHERE status = 'pending'
const PENDING_TASK_ORDERS_SQL = `
  SELECT DISTINCT order_id FROM saga_tasks WHERE status = 'pending' LIMIT $1::int`;

// Task cuối xong nhưng finish lỗi (Processing_Flow §3)
const COMPENSATING_DONE_SQL = `
  SELECT o.id FROM orders o
  WHERE o.status = 'processing' AND o.saga_step = 'compensating'
    AND o.updated_at < LOCALTIMESTAMP - $1::int * interval '1 millisecond'
    AND NOT EXISTS (
      SELECT 1 FROM saga_tasks t WHERE t.order_id = o.id AND t.status = 'pending')
  LIMIT $2::int`;

@Injectable()
export class ReconcileJob {
  private readonly logger = new Logger(ReconcileJob.name);
  private readonly enabled: boolean;
  private running = false;

  constructor(
    private readonly ds: DataSource,
    @InjectRepository(OrderItem)
    private readonly items: Repository<OrderItem>,
    private readonly saga: CheckoutSagaService,
    private readonly compensation: CompensationService,
    config: ConfigService,
  ) {
    this.enabled =
      config.getOrThrow<CheckoutConfig>('checkout').resilienceEnabled;
  }

  // Chu kỳ đọc từ SAGA_RECONCILE_INTERVAL_MS lúc nạp module (như PRICE_ALERT_CRON của catalog)
  @Interval('saga-reconcile', checkoutConfig().reconcileIntervalMs)
  async tick(): Promise<void> {
    if (!this.enabled || this.running) return;
    this.running = true;
    try {
      await this.step('đơn kẹt', () => this.reconcileStuck());
      await this.step('task tồn', () => this.retryPendingTasks());
      await this.step('chốt hoàn tác', () => this.finishCompensated());
    } finally {
      this.running = false;
    }
  }

  // 1. Đơn đang chạy dở mà không request nào giữ
  private async reconcileStuck(): Promise<void> {
    const orders = await this.claimStuckOrders();
    for (const order of orders) {
      await this.each(order.id, () => {
        // Thiếu saga_deadline coi như quá hạn: hoàn tác thay vì thử lại mãi
        const deadline = order.saga_deadline?.getTime() ?? 0;
        return Date.now() > deadline
          ? this.compensation.startForFailedSaga(order, timeoutError())
          : this.saga.advance(order); // không deadline: cron không có ngân sách request
      });
    }
  }

  // 2. Việc hoàn tác còn tồn (lỗi, hết ngân sách, order chết giữa chừng)
  private async retryPendingTasks(): Promise<void> {
    const rows = await this.ds.query<Array<{ order_id: string }>>(
      PENDING_TASK_ORDERS_SQL,
      [BATCH],
    );
    for (const { order_id } of rows) {
      await this.each(order_id, () => this.compensation.run(order_id));
    }
  }

  // 3. Đơn compensating không còn task pending → run gọi thẳng finish
  private async finishCompensated(): Promise<void> {
    const rows = await this.ds.query<Array<{ id: string }>>(
      COMPENSATING_DONE_SQL,
      [MIN_AGE_MS, BATCH],
    );
    for (const { id } of rows) {
      await this.each(id, () => this.compensation.run(id));
    }
  }

  // Một câu chọn + đánh dấu, một câu items cho cả lô (không đọc từng đơn)
  private async claimStuckOrders(): Promise<Order[]> {
    const [orders] = await this.ds.query<[Order[], number]>(CLAIM_STUCK_SQL, [
      MIN_AGE_MS,
      BATCH,
    ]);
    if (!orders.length) return [];
    const lines = await this.items.find({
      where: { order_id: In(orders.map((o) => o.id)) },
    });
    return orders.map((o) => ({
      ...o,
      items: lines.filter((l) => l.order_id === o.id),
    }));
  }

  // Lỗi của một bước (câu chọn) không dừng bước sau
  private async step(name: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.logger.error(`Đối soát (${name}) lỗi: ${message(err)}`);
    }
  }

  // Lỗi của một đơn không dừng đơn khác; chỉ log id đơn + lỗi ngắn
  private async each(
    orderId: string,
    fn: () => Promise<unknown>,
  ): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.logger.warn(`Đối soát đơn ${orderId} lỗi: ${message(err)}`);
    }
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message.slice(0, 200) : String(err);
}
