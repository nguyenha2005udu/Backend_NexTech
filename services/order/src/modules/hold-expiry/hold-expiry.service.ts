// Huỷ đơn quá hạn giữ hàng (BR-19, NT.ORDER_HOLD v1.4 Component_Class_Design §7). Chức năng mới, không có trong be/.
// - Đơn có link PayOS đang chờ: hỏi PayOS NGOÀI khoá và ngoài transaction. PAID → ghi nhận tiền, KHÔNG BAO GIỜ huỷ
//   (BR-10). PayOS lỗi một lần → cả lượt không gọi nữa (tick.payosDown), hoãn tối đa ORDER_HOLD_MAX_DEFER_MS.
// - Huỷ dưới khoá đơn không chờ (waitMs 0, BR-20), FOR UPDATE + kiểm lại hạn trong transaction: COD vừa dừng hạn,
//   đã trả, đã huỷ thì bỏ qua. Độ đúng khi nhiều bên cùng chạy đến từ FOR UPDATE; khoá Redis chỉ để không chờ vô ích.
// - Huỷ đi qua OrderCancelService.cancel(m, o, 'system', 'payment_timeout') như người mua/admin, nhả sau commit qua
//   releaseAfterCommit (v1.4). Outbox order.cancelled: T4.1.
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import type { PayOS } from '@payos/node';
import { DataSource, Repository } from 'typeorm';
import type { HoldConfig } from '../../config/configuration';
import { PAYOS_CLIENT } from '../../config/payos';
import { OrderLockBusyError } from '../../database/db-lock-error';
import { Order } from '../../database/entities/order.entity';
import { Payment } from '../../database/entities/payment.entity';
import { OrderLockService } from '../../redis/order-lock.service';
import { OrderCancelService } from '../checkout/order-cancel.service';
import { HoldScheduleService } from '../order-hold/hold-schedule.service';
import { PaymentCoreService } from '../payment/payment-core.service';

/** Trạng thái dùng chung của một lượt job: PayOS lỗi một lần thì cả lượt không gọi nữa (NFR-ORD-05) */
export interface TickState {
  payosDown: boolean;
}

export type ExpireResult = 'cancelled' | 'paid' | 'skipped' | 'deferred';

@Injectable()
export class HoldExpiryService {
  private readonly cfg: HoldConfig;
  /** Đơn đang hoãn → thời điểm được xử lý lại; đường quét DB loại các đơn này (§8) */
  readonly deferUntil = new Map<string, number>();

  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    private readonly ds: DataSource,
    @Inject(PAYOS_CLIENT) private readonly payos: PayOS,
    private readonly paymentCore: PaymentCoreService,
    private readonly cancelService: OrderCancelService,
    private readonly lock: OrderLockService,
    private readonly hold: HoldScheduleService,
    config: ConfigService,
  ) {
    this.cfg = config.getOrThrow<HoldConfig>('hold');
  }

  async expireOne(orderId: string, tick: TickState): Promise<ExpireResult> {
    const order = await this.orders.findOneBy({ id: orderId });
    if (
      !order ||
      order.status !== 'pending' ||
      order.payment_expires_at === null
    ) {
      await this.hold.unschedule(orderId); // không còn gì để hẹn
      return 'skipped';
    }
    if (!this.isDue(order)) {
      // Lệch đồng hồ app/DB hoặc hẹn sớm: hẹn lại đúng hạn
      await this.hold.schedule(orderId, order.payment_expires_at);
      return 'skipped';
    }

    // 1. Có link PayOS đang chờ: hỏi PayOS, ngoài khoá và ngoài transaction
    const p = await this.payments.findOneBy({ order_id: orderId });
    if (p?.method === 'payos' && p.status === 'pending' && p.transaction_id) {
      let info: { status: string; amountPaid?: number } | undefined;
      if (!tick.payosDown) {
        try {
          info = await this.payos.paymentRequests.get(Number(p.transaction_id));
        } catch {
          tick.payosDown = true; // một lỗi: cả lượt này không gọi PayOS nữa
        }
      }
      if (info?.status === 'PAID') {
        // Đã có tiền: KHÔNG BAO GIỜ đi xuống nhánh huỷ
        try {
          await this.paymentCore.markSuccess(
            {
              paymentId: p.id,
              gatewayResponse: info,
              paidAmount: info.amountPaid,
            },
            { waitMs: 0 },
          );
          return 'paid';
        } catch (e) {
          if (e instanceof OrderLockBusyError) return this.deferred(orderId);
          throw e; // NT-PAY-1005, lỗi DB: job log, đơn giữ nguyên, lượt sau thử lại
        }
      }
      if (
        !info &&
        Date.now() < order.payment_expires_at.getTime() + this.cfg.maxDeferMs
      ) {
        return this.deferred(orderId); // không hỏi được PayOS, còn trong hạn hoãn
      }
      // PayOS báo khác PAID, hoặc quá hạn hoãn: huỷ (tiền về sau thì BR-10)
    }

    // 2. Huỷ dưới khoá, không chờ
    let r: Awaited<ReturnType<OrderCancelService['cancel']>> | null;
    try {
      r = await this.lock.withOrderLock(
        orderId,
        () =>
          this.ds.transaction(async (m) => {
            const locked = await m.findOne(Order, {
              where: { id: orderId },
              lock: { mode: 'pessimistic_write' },
            });
            // COD vừa dừng hạn, đã trả, đã huỷ
            if (!locked || !this.isDue(locked)) return null;
            return this.cancelService.cancel(
              m,
              locked,
              'system',
              'payment_timeout',
            );
          }),
        { waitMs: 0 },
      );
    } catch (e) {
      if (e instanceof OrderLockBusyError) return this.deferred(orderId);
      throw e;
    }
    await this.hold.unschedule(orderId);
    this.deferUntil.delete(orderId);
    if (!r) return 'skipped';
    // Như người mua/admin huỷ (NT.CHECKOUT_SAGA v1.7): lỗi thì saga_tasks còn tồn, ReconcileJob thử lại
    await this.cancelService.releaseAfterCommit(orderId, r.tasks);
    return 'cancelled';
  }

  /** Xoá đơn hết thời gian hoãn khỏi danh sách loại trừ của đường quét DB */
  pruneDeferred(now = Date.now()): void {
    for (const [id, until] of this.deferUntil) {
      if (until <= now) this.deferUntil.delete(id);
    }
  }

  private async deferred(orderId: string): Promise<'deferred'> {
    const until = Date.now() + this.cfg.deferBackoffMs;
    await this.hold.defer(orderId, until); // Redis: lùi điểm, không chiếm đầu danh sách
    this.deferUntil.set(orderId, until); // đường quét DB: loại khỏi truy vấn
    return 'deferred';
  }

  private isDue(o: Order): boolean {
    return (
      o.status === 'pending' &&
      o.payment_expires_at !== null &&
      o.payment_expires_at.getTime() + this.cfg.graceMs <= Date.now()
    );
  }
}
