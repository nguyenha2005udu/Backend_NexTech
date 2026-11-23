// Huỷ đơn (NT.CHECKOUT_SAGA Component_Class_Design §7.1 v1.7, API_Spec §2, Processing_Flow §5). Chép từ
// be/src/users/order/order.service.ts cancel (dòng 384–412): khoá dòng đơn của người gọi, chỉ huỷ `pending`
// (CANCELABLE_STATUSES dòng 25, bỏ simulated_success), giữ câu chữ và response { id, status, updated_at }.
// Đổi do tách service (source-of-truth §2): releaseOrderResources (be/src/users/order/order-inventory.util.ts
// dòng 51–80) cộng kho, trừ used_count trong cùng transaction → tạo saga_tasks trong transaction, nhả kho/mã
// qua catalog, promotion sau commit (không gọi HTTP khi giữ transaction). Lệnh lỗi thì ReconcileJob thử lại.
// Dùng chung cho người mua và admin (NT.ORDER API_Spec route 11), hệ thống khi quá hạn (T3.10).
// T3.6: giao dịch pending → failed (voidPendingByOrder) trong cùng transaction, như releaseOrderResources của be/.
// T3.9: cancelByUser bọc withOrderLock (BR-20), bận → 409 NT-ORD-1012. T3.10: gỡ hẹn hạn giữ hàng sau commit; cancel
// nhận by = system, reason = payment_timeout (HoldExpiryService). Chưa có: outbox order.cancelled (T4.1).
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import type { CheckoutConfig } from '../../config/configuration';
import { Order } from '../../database/entities/order.entity';
import { SagaTask } from '../../database/entities/saga-task.entity';
import { cannotCancel, lockBusyTo409, orderNotFound } from '../../errors';
import { OrderLockService } from '../../redis/order-lock.service';
import { HoldScheduleService } from '../order-hold/hold-schedule.service';
import { PaymentCoreService } from '../payment/payment-core.service';
import { CompensationService, compensationTasks } from './compensation.service';

export type CancelledBy = 'user' | 'admin' | 'system';

export interface CancelResponse {
  id: string;
  status: 'cancelled';
  updated_at: Date;
}

export type CancelTask = Pick<SagaTask, 'id' | 'order_id' | 'type' | 'seq'>;

@Injectable()
export class OrderCancelService {
  private readonly logger = new Logger(OrderCancelService.name);
  private readonly budgetMs: number;

  constructor(
    private readonly ds: DataSource,
    private readonly compensation: CompensationService,
    private readonly paymentCore: PaymentCoreService,
    config: ConfigService,
    private readonly lock: OrderLockService,
    private readonly hold: HoldScheduleService,
  ) {
    this.budgetMs = config.getOrThrow<CheckoutConfig>('checkout').budgetMs;
  }

  // PUT /api/orders/:id/cancel. Khoá đơn có thời hạn (BR-20) rồi mới mở transaction (NT.CHECKOUT_SAGA §7.1)
  async cancelByUser(userId: string, id: string): Promise<CancelResponse> {
    const { result, tasks } = await this.lock
      .withOrderLock(id, () => this.cancelByUserTx(userId, id))
      .catch(lockBusyTo409);
    await this.hold.unschedule(id); // sau commit (BR-19)
    await this.releaseAfterCommit(id, tasks);
    return result;
  }

  private cancelByUserTx(userId: string, id: string) {
    return this.ds.transaction(async (m) => {
      // Khoá dòng đơn: 2 request huỷ song song không nhả 2 lần, webhook thanh toán phải đợi (như be/)
      const order = await m.findOne(Order, {
        where: { id, user_id: userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!order) throw orderNotFound();
      if (order.status !== 'pending') throw cannotCancel();
      return this.cancel(m, order, 'user');
    });
  }

  /**
   * Dùng chung: người mua, admin, hệ thống. Bên gọi đã khoá đơn và kiểm trạng thái; chạy trong transaction
   * của bên gọi, không gọi HTTP. Bên gọi chạy releaseAfterCommit sau commit.
   * `by`: cancelled_by của sự kiện order.cancelled (T4.1).
   */
  async cancel(
    m: EntityManager,
    order: Order,
    by: CancelledBy,
    reason?: 'payment_timeout',
  ): Promise<{ result: CancelResponse; tasks: CancelTask[] }> {
    // UPDATE … RETURNING (v1.7): m.save của be/ có thể đọc lại đơn thêm một câu
    const updated = await m
      .createQueryBuilder()
      .update(Order)
      .set({ status: 'cancelled' })
      .where('id = :id', { id: order.id })
      .returning(['updated_at'])
      .execute();
    const rows = updated.raw as Array<{ updated_at: Date }>;

    // Giao dịch pending → failed; success giữ nguyên để hoàn tiền tay (be/ dòng 77–79, BR-10)
    await this.paymentCore.voidPendingByOrder(m, order.id);
    const list = compensationTasks(order);
    const inserted = await m.insert(SagaTask, list);
    // T4.1: outbox order.cancelled { order_id, user_id, cancelled_by: by }. Tới lúc đó ghi log để lần ra
    // ai huỷ (chỉ id đơn và vai, không dữ liệu cá nhân — security-policy §5)
    this.logger.log(
      `Đơn ${order.id} huỷ bởi ${by}${reason ? ` (${reason})` : ''}`,
    );

    return {
      result: {
        id: order.id,
        status: 'cancelled',
        updated_at: rows[0].updated_at,
      },
      tasks: list.map((t, i) => ({
        id: String(inserted.identifiers[i].id),
        ...t,
      })),
    };
  }

  /**
   * Sau commit: nhả mã, nhả kho trong ngân sách SAGA_BUDGET_MS, bằng đúng task vừa tạo, không chốt
   * failed (v1.7). Lỗi gì cũng chỉ log: đơn đã cancelled, client vẫn nhận 200; task còn pending để
   * ReconcileJob thử lại (test 17, 31).
   */
  async releaseAfterCommit(
    orderId: string,
    tasks: CancelTask[],
  ): Promise<void> {
    try {
      await this.compensation.run(orderId, {
        tasks,
        finish: false,
        deadline: Date.now() + this.budgetMs,
      });
    } catch (err) {
      this.logger.warn(
        `Huỷ ${orderId}: nhả tài nguyên lỗi, để đối soát (${(err as Error)?.message ?? String(err)})`,
      );
    }
  }
}
