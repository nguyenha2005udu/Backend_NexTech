// Chép từ be/src/users/payment/payment.service.ts. Đổi theo NT.PAYMENT API_Spec §1, Component_Class_Design §2 (v2.7):
// - create: sinh và LƯU orderCode TRƯỚC khi gọi PayOS (be/ lưu sau, sổ A2); dòng failed được dùng lại, mã cũ đẩy
//   vào previous_transaction_ids thay vì xoá; PayOS lỗi/timeout → 503 NT-PAY-1006 (be/ 400 kèm lỗi PayOS), giữ mã.
//   Chống đua với job huỷ quá hạn bằng UPDATE orders có điều kiện trong transaction ghi giao dịch, không khoá Redis
//   (sổ A7, NT.ORDER_HOLD API_Spec §2): COD dừng hạn (payment_expires_at NULL). Thêm NT-PAY-1010, expires_at,
//   expiredAt gửi PayOS (BR-19). Không giữ transaction khi gọi PayOS. T3.10: unschedule sau commit (COD).
// - getStatus: giữ cơ chế chủ động hỏi PayOS; PAID đi qua markSuccess với giao dịch đã đọc (khỏi tra lại).
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import type { PayOS } from '@payos/node';
import { DataSource, EntityManager, Repository } from 'typeorm';
import type { PayosConfig } from '../../config/configuration';
import { PAYOS_CLIENT } from '../../config/payos';
import { Order } from '../../database/entities/order.entity';
import { Payment } from '../../database/entities/payment.entity';
import { isUniqueViolation } from '../../database/unique-violation';
import {
  orderNotPayable,
  paymentExists,
  paymentExpired,
  paymentForbidden,
  paymentNotFound,
  paymentOrderNotFound,
  providerFailed,
} from '../../errors';
import { PaymentCoreService } from './payment-core.service';
import { CreatePaymentDto } from './payment.dto';
import { generateProviderOrderCode } from './provider-order-code.util';

// payments.order_id UNIQUE (một đơn tối đa một giao dịch) — tên ràng buộc trong migration Init
const UQ_PAYMENT_ORDER = 'REL_b2f7b823a21562eeca20e72b00';

// PayOS trả các trạng thái này thì link không còn dùng được (be/)
const DEAD_LINK = ['CANCELLED', 'EXPIRED', 'FAILED'];

@Injectable()
export class PaymentService {
  private readonly cfg: PayosConfig;

  constructor(
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    private readonly dataSource: DataSource,
    @Inject(PAYOS_CLIENT) private readonly payos: PayOS,
    private readonly paymentCore: PaymentCoreService,
    config: ConfigService,
  ) {
    this.cfg = config.getOrThrow<PayosConfig>('payos');
  }

  // POST /api/payments
  async create(userId: string, dto: CreatePaymentDto) {
    const order = await this.orderRepo.findOne({
      where: { id: dto.order_id, user_id: userId },
    });
    if (!order) throw paymentOrderNotFound();
    if (order.status !== 'pending') throw orderNotPayable(order.status);

    const existing = await this.paymentRepo.findOne({
      where: { order_id: order.id },
    });
    if (existing && existing.status !== 'failed') throw paymentExists();
    if (expired(order.payment_expires_at)) throw paymentExpired();

    const isPayos = dto.method === 'payos';
    const orderCode = isPayos ? generateProviderOrderCode() : null;

    const paymentId = await this.dataSource
      .transaction(async (m) => {
        await this.holdOrder(m, order.id, !isPayos);
        return this.writePayment(m, order, existing, dto.method, orderCode);
      })
      .catch((err: unknown) => {
        // Hai lần tạo đồng thời cho cùng đơn: lần sau vướng unique order_id
        if (isUniqueViolation(err, UQ_PAYMENT_ORDER)) throw paymentExists();
        throw err;
      });
    // T3.10: COD → HoldScheduleService.unschedule(order.id) sau commit

    let payment_url: string | null = null;
    // Chuỗi VietQR để FE render mã QR ngay trong app (quét bằng app ngân hàng) — như be/
    let qr_code: string | null = null;

    if (isPayos && orderCode !== null) {
      const link = await this.createLink(paymentId, order, orderCode);
      payment_url = link.checkoutUrl;
      qr_code = link.qrCode ?? null;
    }

    return {
      id: paymentId,
      order_id: order.id,
      method: dto.method,
      amount: order.total,
      currency: 'VND',
      status: 'pending' as const,
      payment_url,
      qr_code,
      // PayOS: bằng hạn giữ hàng (hạn vẫn chạy); COD: đã dừng hạn
      expires_at: isPayos ? order.payment_expires_at : null,
    };
  }

  // GET /api/payments/:id/status
  async getStatus(userId: string, paymentId: string) {
    // be/ dùng relations: { order: true }; findOne + relations sinh 2 câu (DISTINCT … LIMIT rồi lấy dữ liệu),
    // getOne một câu cho cùng kết quả (detail ≤ 3, non-functional §1)
    const payment = await this.paymentRepo
      .createQueryBuilder('payment')
      .innerJoinAndSelect('payment.order', 'order')
      .where('payment.id = :id', { id: paymentId })
      .getOne();
    if (!payment) throw paymentNotFound();
    if (payment.order.user_id !== userId) throw paymentForbidden();

    // Webhook PayOS không gọi được vào localhost, nên khi giao dịch payos còn 'pending' ta CHỦ ĐỘNG hỏi PayOS
    // trạng thái thật rồi đồng bộ vào DB (be/). T3.9: markSuccess không chờ khoá đơn (waitMs 0).
    if (
      payment.method === 'payos' &&
      payment.status === 'pending' &&
      payment.transaction_id
    ) {
      try {
        const info = await this.payos.paymentRequests.get(
          Number(payment.transaction_id),
        );
        const response = info as unknown as Record<string, unknown>;
        if (info.status === 'PAID') {
          const r = await this.paymentCore.markSuccess({
            found: { id: payment.id, order_id: payment.order_id },
            gatewayResponse: response,
            paidAmount: info.amountPaid,
          });
          payment.status = r.status;
          payment.paid_at = r.paid_at;
        } else if (DEAD_LINK.includes(info.status)) {
          const r = await this.paymentCore.markFailed({
            paymentId: payment.id,
            gatewayResponse: response,
          });
          payment.status = r.status;
        }
      } catch {
        // Lỗi khi hỏi PayOS (hoặc ghi nhận) → giữ nguyên, lần poll sau thử lại (be/)
      }
    }

    return {
      id: payment.id,
      status: payment.status,
      paid_at: payment.paid_at,
      transaction_id: payment.transaction_id,
    };
  }

  /**
   * Giữ chỗ đơn trong transaction ghi giao dịch (NT.ORDER_HOLD API_Spec §2): còn pending và chưa quá hạn mới ghi.
   * Câu UPDATE khoá dòng tới hết transaction, job huỷ quá hạn phải chờ. COD dừng hạn; PayOS chỉ chạm updated_at.
   */
  private async holdOrder(
    m: EntityManager,
    orderId: string,
    stopHold: boolean,
  ): Promise<void> {
    const r = await m
      .createQueryBuilder()
      .update(Order)
      .set(
        stopHold
          ? { payment_expires_at: null }
          : { updated_at: () => 'CURRENT_TIMESTAMP' },
      )
      .where('id = :id', { id: orderId })
      .andWhere("status = 'pending'")
      .andWhere('(payment_expires_at IS NULL OR payment_expires_at > now())')
      .execute();
    if (r.affected) return;

    // Bên khác vừa đổi đơn (huỷ, job quá hạn) giữa lúc kiểm và lúc ghi
    const now = await m.findOneByOrFail(Order, { id: orderId });
    if (now.status !== 'pending') throw orderNotPayable(now.status);
    throw paymentExpired();
  }

  // Một câu ghi: dòng mới, hoặc dùng lại dòng failed (đổi phương thức, mã mới, mã cũ vào previous_transaction_ids)
  private async writePayment(
    m: EntityManager,
    order: Order,
    existing: Payment | null,
    method: 'cod' | 'payos',
    orderCode: number | null,
  ): Promise<string> {
    const values = {
      method,
      amount: order.total,
      currency: 'VND',
      status: 'pending' as const,
      transaction_id: orderCode === null ? null : String(orderCode),
      gateway_response: null,
      paid_at: null,
    };
    if (!existing) {
      const r = await m.insert(Payment, { order_id: order.id, ...values });
      return String(r.identifiers[0].id);
    }
    const previous = existing.transaction_id
      ? [...existing.previous_transaction_ids, existing.transaction_id]
      : existing.previous_transaction_ids;
    // WHERE status='failed': lần tạo song song thứ hai không ghi đè lần đầu
    const r = await m.update(
      Payment,
      { id: existing.id, status: 'failed' },
      { ...values, previous_transaction_ids: previous },
    );
    if (!r.affected) throw paymentExists();
    return existing.id;
  }

  // Gọi PayOS ngoài transaction. Mã đã lưu nên timeout mà PayOS vẫn tạo link thì webhook vẫn tìm ra giao dịch.
  private async createLink(paymentId: string, order: Order, orderCode: number) {
    try {
      const link = await this.payos.paymentRequests.create({
        orderCode,
        amount: Math.round(Number(order.total)),
        description: `Thanh toan #${paymentId}`.slice(0, 25),
        returnUrl: this.cfg.returnUrl,
        cancelUrl: this.cfg.cancelUrl,
        // Link hết hạn cùng lúc với hạn giữ hàng (BR-19); giây
        ...(order.payment_expires_at
          ? { expiredAt: Math.floor(order.payment_expires_at.getTime() / 1000) }
          : {}),
      });
      await this.paymentRepo.update(
        { id: paymentId, status: 'pending' },
        { gateway_response: link },
      );
      return link;
    } catch {
      // Giữ transaction_id: lần thử lại sinh mã mới, mã này vào previous_transaction_ids. Không đưa lỗi PayOS
      // ra client (security-policy §5)
      await this.paymentRepo.update(
        { id: paymentId, status: 'pending' },
        { status: 'failed' },
      );
      throw providerFailed();
    }
  }
}

function expired(at: Date | null): boolean {
  return at !== null && at.getTime() <= Date.now();
}
