// Chép từ be/src/users/payment/payment-core.service.ts. Đổi theo NT.PAYMENT Component_Class_Design §4, §4.1 (v2.7):
// - markSuccess: tìm giao dịch (findForWebhook, tra cả mã cũ previous_transaction_ids) NGOÀI transaction để biết
//   order_id rồi bọc withOrderLock(order_id) (T3.9, BR-20; khoá bận → OrderLockBusyError, bên gọi đổi); trong transaction khoá đơn rồi khoá giao dịch như be/; ghi bằng UPDATE thay
//   save (bớt câu đọc lại). Thêm BR-10: trả hai link → needs_refund; tiền về khi đơn huỷ/failed → needs_refund.
//   Chốt sổ tiền về cùng transaction (ledgerId). T4.1: outbox order.paid. T3.10: gỡ hẹn hạn giữ hàng sau commit.
// - markFailed: một UPDATE … WHERE status='pending' (B15) thay đọc rồi save: không ghi failed đè success.
// - confirmCod: withOrderLock (T3.9), khoá đơn rồi giao dịch như markSuccess (be/ không khoá đơn); đổi đơn paid như be/.
// - confirmCodForOrder → confirmCodByOrder(manager, orderId); thêm voidPendingByOrder (từ releaseOrderResources
//   của be/ dòng 77–79), sumRevenue (từ getOverview của be/ admin/statistics, dòng 45–51).
import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { Order } from '../../database/entities/order.entity';
import { orderEvents } from '../../outbox/order-events';
import { Payment } from '../../database/entities/payment.entity';
import type { LedgerOutcome } from '../../database/entities/payment-transaction.entity';
import {
  amountMismatch,
  codOnly,
  invalidPaymentState,
  paymentNotFound,
} from '../../errors';
import {
  OrderLockService,
  type OrderLockOptions,
} from '../../redis/order-lock.service';
import { HoldScheduleService } from '../order-hold/hold-schedule.service';
import { PaymentLedgerService } from './payment-ledger.service';

/** id và order_id của giao dịch — đủ để khoá đơn trước */
export interface PaymentRef {
  id: string;
  order_id: string;
}

export interface MarkSuccessParams {
  /** Webhook: kết quả findForWebhook. Poll: giao dịch đã đọc */
  found?: PaymentRef;
  /** Tra theo id khi không có found */
  paymentId?: string;
  /** Chỉ webhook: mã PayOS khách đã trả — so với mã đã ghi nhận để phát hiện trả hai link */
  orderCode?: number | string;
  /** Số tiền cổng báo đã nhận — phải khớp payment.amount (BR-09) */
  paidAmount?: number;
  gatewayResponse?: Record<string, unknown>;
  /** Dòng sổ tiền về cần chốt (chỉ webhook) */
  ledgerId?: string;
}

@Injectable()
export class PaymentCoreService {
  private readonly logger = new Logger(PaymentCoreService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly ledger: PaymentLedgerService,
    private readonly lock: OrderLockService,
    private readonly hold: HoldScheduleService,
  ) {}

  /** Tìm giao dịch theo mã PayOS hiện hành hoặc mã cũ (index GIN ix_payments_prev_codes) */
  async findForWebhook(orderCode: number | string): Promise<PaymentRef | null> {
    const c = String(orderCode);
    const found = await this.dataSource
      .getRepository(Payment)
      .createQueryBuilder('p')
      .select(['p.id', 'p.order_id'])
      .where(
        '(p.transaction_id = :c OR :c = ANY(p.previous_transaction_ids))',
        { c },
      )
      .getOne();
    return found ? { id: found.id, order_id: found.order_id } : null;
  }

  /** opts.waitMs: webhook mặc định; poll, job truyền 0 (NT.PAYMENT Component_Class_Design §4 v2.3) */
  async markSuccess(
    params: MarkSuccessParams,
    opts: OrderLockOptions = {},
  ): Promise<Payment> {
    const found =
      params.found ??
      (params.paymentId
        ? await this.refById(params.paymentId)
        : params.orderCode !== undefined
          ? await this.findForWebhook(params.orderCode)
          : null);
    if (!found) throw paymentNotFound();

    const saved = await this.lock.withOrderLock(
      found.order_id,
      () => this.markSuccessTx(found, params),
      opts,
    );
    // Giao dịch success thì đơn không còn pending (paid, hoặc đã huỷ/giao + needs_refund): gỡ hẹn không điều kiện,
    // gỡ thừa vô hại, khỏi đọc lại đơn (NT.ORDER_HOLD v1.4, T3.10)
    await this.hold.unschedule(found.order_id);
    return saved;
  }

  private markSuccessTx(
    found: PaymentRef,
    params: MarkSuccessParams,
  ): Promise<Payment> {
    return this.dataSource.transaction(async (m) => {
      // Khoá đơn trước rồi mới khoá giao dịch (cùng thứ tự với huỷ đơn, không deadlock). Webhook và poll có thể
      // chạy đồng thời → chỉ một bên xử lý.
      const order = await m.findOne(Order, {
        where: { id: found.order_id },
        lock: { mode: 'pessimistic_write' },
      });
      const p = await m.findOne(Payment, {
        where: { id: found.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!p) throw paymentNotFound();

      if (p.status === 'success') {
        // Cùng mã: webhook và poll trùng nhau. Khác mã: khách trả qua cả link cũ lẫn link mới (BR-10)
        // orderCode trong gateway_response: số (webhook, PayOS) — chỉ so khi là số hoặc chuỗi
        const raw = p.gateway_response?.orderCode;
        const paidCode =
          typeof raw === 'number' || typeof raw === 'string'
            ? String(raw)
            : null;
        if (
          params.orderCode !== undefined &&
          paidCode !== null &&
          paidCode !== String(params.orderCode)
        ) {
          await m.update(Payment, { id: p.id }, { needs_refund: true });
          this.logger.warn(
            `Giao dịch ${p.id} nhận tiền lần hai qua mã ${params.orderCode}: cần hoàn tiền tay`,
          );
          await this.settle(m, params.ledgerId, p.id, 'duplicate_payment');
          return { ...p, needs_refund: true };
        }
        await this.settle(m, params.ledgerId, p.id, 'applied');
        return p;
      }

      // Cho phép failed → success: đơn bị huỷ đánh giao dịch pending thành failed, nhưng khách vẫn trả qua link cũ
      // thì tiền đã vào → phải ghi nhận để hoàn tiền (be/, BR-10)
      if (p.status !== 'pending' && p.status !== 'failed') {
        throw invalidPaymentState(p.status, 'chuyển sang success');
      }
      if (
        params.paidAmount !== undefined &&
        Number(params.paidAmount) !== Number(p.amount)
      ) {
        throw amountMismatch(params.paidAmount, p.amount);
      }

      const payable = order?.status === 'pending';
      const kept = order?.status === 'paid' || order?.status === 'shipped';
      const needsRefund = !payable && !kept;
      const paidAt = new Date();
      await m.update(
        Payment,
        { id: p.id },
        {
          status: 'success',
          paid_at: paidAt,
          ...(params.gatewayResponse
            ? { gateway_response: asJson(params.gatewayResponse) }
            : {}),
          ...(needsRefund ? { needs_refund: true } : {}),
        },
      );

      if (payable && order) {
        await m.update(Order, { id: found.order_id }, { status: 'paid' });
        // T4.1: order.paid cùng transaction
        await orderEvents.paid(m, order);
      } else if (needsRefund) {
        // Đơn huỷ/failed mà khách vẫn chuyển khoản → giữ nguyên đơn, hoàn tiền tay
        this.logger.warn(
          `Giao dịch ${p.id} thành công nhưng đơn ${found.order_id} đang "${order?.status}": cần hoàn tiền tay`,
        );
      }
      await this.settle(
        m,
        params.ledgerId,
        p.id,
        needsRefund ? 'order_not_payable' : 'applied',
      );
      return {
        ...p,
        status: 'success',
        paid_at: paidAt,
        needs_refund: p.needs_refund || needsRefund,
        gateway_response: params.gatewayResponse ?? p.gateway_response,
      };
    });
  }

  /** Một câu có điều kiện: chỉ đổi khi còn pending; success/refunded/failed trả nguyên (B15) */
  async markFailed(params: {
    paymentId?: string;
    transactionId?: string;
    gatewayResponse?: Record<string, unknown>;
  }): Promise<Payment> {
    const { paymentId, transactionId, gatewayResponse } = params;
    const r = await this.dataSource
      .createQueryBuilder()
      .update(Payment)
      .set({
        status: 'failed',
        ...(gatewayResponse
          ? { gateway_response: asJson(gatewayResponse) }
          : {}),
      })
      .where(paymentId ? 'id = :k' : 'transaction_id = :k', {
        k: paymentId ?? transactionId,
      })
      .andWhere("status = 'pending'")
      .returning('*')
      .execute();
    const rows = r.raw as Payment[];
    if (rows.length) return rows[0];

    const p = await this.dataSource.getRepository(Payment).findOne({
      where: paymentId ? { id: paymentId } : { transaction_id: transactionId },
    });
    if (!p) throw paymentNotFound();
    return p;
  }

  // POST /api/admin/payments/:id/confirm-cod — "xác nhận đã thu tiền", độc lập với giao hàng (be/)
  async confirmCod(paymentId: string): Promise<Payment> {
    const found = await this.refById(paymentId);
    if (!found) throw paymentNotFound();

    const saved = await this.lock.withOrderLock(found.order_id, () =>
      this.confirmCodTx(found),
    );
    await this.hold.unschedule(found.order_id); // đơn paid (BR-19)
    return saved;
  }

  private confirmCodTx(found: PaymentRef): Promise<Payment> {
    return this.dataSource.transaction(async (m) => {
      const order = await m.findOne(Order, {
        where: { id: found.order_id },
        lock: { mode: 'pessimistic_write' },
      });
      const p = await m.findOne(Payment, {
        where: { id: found.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!p) throw paymentNotFound();
      if (p.method !== 'cod') throw codOnly();
      if (p.status !== 'pending') {
        throw invalidPaymentState(p.status, 'xác nhận thu tiền');
      }
      const paidAt = new Date();
      await m.update(
        Payment,
        { id: p.id },
        { status: 'success', paid_at: paidAt },
      );
      // be/: đặt đơn paid (không điều kiện). T4.1: order.paid cùng transaction
      await m.update(Order, { id: p.order_id }, { status: 'paid' });
      if (order) await orderEvents.paid(m, order);
      return { ...p, status: 'success', paid_at: paidAt };
    });
  }

  /**
   * Admin giao đơn COD (pending → shipped): giao dịch COD pending → success trong transaction của bên gọi; bên gọi
   * tự đổi đơn. Trường hợp khác không làm gì, không ném lỗi (be/ confirmCodForOrder). true khi đã ghi nhận.
   */
  async confirmCodByOrder(m: EntityManager, orderId: string): Promise<boolean> {
    const r = await m.update(
      Payment,
      { order_id: orderId, method: 'cod', status: 'pending' },
      { status: 'success', paid_at: new Date() },
    );
    return (r.affected ?? 0) > 0;
  }

  /** Huỷ đơn: giao dịch pending → failed trong transaction huỷ; success giữ nguyên để hoàn tiền tay (BR-10) */
  async voidPendingByOrder(m: EntityManager, orderId: string): Promise<void> {
    await m.update(
      Payment,
      { order_id: orderId, status: 'pending' },
      { status: 'failed' },
    );
  }

  /** Tổng tiền giao dịch success, lọc theo paid_at (be/ getOverview). Thống kê tổng quan dùng (T3.7) */
  async sumRevenue(from?: Date, to?: Date): Promise<number> {
    const qb = this.dataSource
      .getRepository(Payment)
      .createQueryBuilder('payment')
      .select('COALESCE(SUM(payment.amount), 0)', 'revenue')
      .where('payment.status = :status', { status: 'success' });
    if (from) qb.andWhere('payment.paid_at >= :from', { from });
    if (to) qb.andWhere('payment.paid_at <= :to', { to });
    const raw = await qb.getRawOne<{ revenue: string }>();
    return Number(raw?.revenue ?? 0);
  }

  private async refById(id: string): Promise<PaymentRef | null> {
    const p = await this.dataSource
      .getRepository(Payment)
      .findOne({ where: { id }, select: { id: true, order_id: true } });
    return p ? { id: p.id, order_id: p.order_id } : null;
  }

  private async settle(
    m: EntityManager,
    ledgerId: string | undefined,
    paymentId: string,
    outcome: LedgerOutcome,
  ): Promise<void> {
    if (ledgerId) await this.ledger.settleIn(m, ledgerId, paymentId, outcome);
  }
}

// Cột json: kiểu "deep partial" của TypeORM không nhận Record<string, unknown> trực tiếp
function asJson(
  v: Record<string, unknown>,
): QueryDeepPartialEntity<Payment>['gateway_response'] {
  return v as QueryDeepPartialEntity<Payment>['gateway_response'];
}
