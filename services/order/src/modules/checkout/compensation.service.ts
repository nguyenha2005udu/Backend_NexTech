// Hoàn tác saga đặt hàng (NT.CHECKOUT_SAGA Component_Class_Design §6, v1.6; Processing_Flow §2–3).
// Mới, không có trong be/: be/ dùng một transaction nên lỗi thì rollback (source-of-truth §2: transaction
// chung nhiều service → saga). Việc hoàn tác lưu ở saga_tasks để lỗi thì cron (T3.5) thử lại.
// T3.4: startForFailedSaga, run, finish. OrderCancelService (T3.5) cũng tạo task rồi gọi run.
// Outbox order.failed khi notify_on_finish: T4.1.
import { HttpException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { UpstreamBusinessError, UpstreamError } from '@nextech/service-kit';
import { DataSource, In, Not, Repository } from 'typeorm';
import { CatalogClient } from '../../clients/catalog.client';
import { PromotionClient } from '../../clients/promotion.client';
import { Order } from '../../database/entities/order.entity';
import {
  SagaTask,
  type SagaTaskType,
} from '../../database/entities/saga-task.entity';
import { failureFieldsOf, isBudgetExhausted } from './saga.types';

// seq: thứ tự khởi chạy, ngược lúc thực hiện (ADR-0005, API_Spec §4)
export function compensationTasks(
  order: Pick<Order, 'id' | 'discount_code' | 'freeship_code'>,
): Array<Pick<SagaTask, 'order_id' | 'type' | 'seq'>> {
  const list: Array<Pick<SagaTask, 'order_id' | 'type' | 'seq'>> = [];
  if (order.discount_code || order.freeship_code) {
    list.push({ order_id: order.id, type: 'release_promotion', seq: 1 });
  }
  // Luôn nhả kho, kể cả khi lỗi ở chính bước giữ kho: lệnh giữ có thể đã tới nơi → tạo tombstone
  list.push({ order_id: order.id, type: 'release_stock', seq: 2 });
  return list;
}

// last_error: chỉ đích, lý do, mã — không lưu body của service đích (security-policy §5)
function describeError(err: unknown): string {
  if (err instanceof UpstreamError) {
    return `${err.target} ${err.reason} (${err.outcome})`;
  }
  if (err instanceof UpstreamBusinessError) {
    return `${err.target} ${err.getStatus()} ${err.upstreamCode ?? ''}`.trim();
  }
  return err instanceof Error ? err.message.slice(0, 500) : String(err);
}

@Injectable()
export class CompensationService {
  constructor(
    @InjectRepository(Order)
    private readonly orders: Repository<Order>,
    @InjectRepository(SagaTask)
    private readonly tasks: Repository<SagaTask>,
    private readonly dataSource: DataSource,
    private readonly catalog: CatalogClient,
    private readonly promotion: PromotionClient,
  ) {}

  /**
   * Đơn đang chạy saga → compensating, lưu lỗi gốc, tạo task, chạy nhả ngay.
   * UPDATE có điều kiện: request và cron cùng gọi thì chỉ một bên tạo task và chạy (test 19).
   * `deadline`: ngân sách còn lại của request (v1.6); cron không truyền.
   */
  async startForFailedSaga(
    order: Order,
    reason: HttpException,
    deadline?: number,
  ): Promise<void> {
    const won = await this.dataSource.transaction(async (m) => {
      const fields = failureFieldsOf(reason);
      const r = await m.update(
        Order,
        { id: order.id, status: 'processing', saga_step: Not('compensating') },
        {
          saga_step: 'compensating',
          ...fields,
          // Lỗi hạ tầng: nhả Idempotency-Key để client gửi lại cùng key thì tạo đơn mới (API_Spec §1 #1)
          ...(fields.failure_status >= 500 ? { idempotency_key: null } : {}),
        },
      );
      if (!r.affected) return false;
      await m.insert(SagaTask, compensationTasks(order));
      return true;
    });
    if (won) await this.run(order.id, deadline);
  }

  /**
   * Chạy các task còn pending theo seq. Task lỗi không chặn task sau (hai lệnh nhả độc lập,
   * reliability-standard §7). Xong hết → finish. Hết ngân sách → dừng, phần còn lại để cron.
   */
  async run(orderId: string, deadline?: number): Promise<void> {
    const pending = await this.tasks.find({
      where: { order_id: orderId, status: 'pending' },
      order: { seq: 'ASC' },
    });
    const done: string[] = [];
    let allDone = true;
    for (const task of pending) {
      if (isBudgetExhausted(deadline)) {
        allDone = false;
        break;
      }
      try {
        await this.execute(task.type, orderId, deadline);
        done.push(task.id);
      } catch (err) {
        await this.tasks.update(
          { id: task.id },
          { attempts: task.attempts + 1, last_error: describeError(err) },
        );
        allDone = false;
      }
    }
    // Một câu cho mọi task xong (v1.6). Chết trước câu này thì lượt sau nhả lại — lệnh nhả idempotent.
    if (done.length) {
      await this.tasks.update(
        { id: In(done) },
        { status: 'done', done_at: new Date() },
      );
    }
    if (allDone) await this.finish(orderId);
  }

  private async execute(
    type: SagaTaskType,
    orderId: string,
    deadline?: number,
  ): Promise<void> {
    if (type === 'release_promotion') {
      await this.promotion.release(orderId, { deadline });
    } else {
      await this.catalog.release(orderId, { deadline });
    }
  }

  // Chỉ saga thất bại: đơn đã pending (thắng confirm) hay cancelled (huỷ đơn) không khớp, không đổi (test 20)
  private async finish(orderId: string): Promise<void> {
    await this.orders.update(
      { id: orderId, status: 'processing', saga_step: 'compensating' },
      { status: 'failed', saga_step: 'compensated' },
    );
  }
}
