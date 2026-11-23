// POST /api/webhooks/payos — chép từ be/src/users/payment/payos-webhook.controller.ts. Đổi theo NT.PAYMENT
// API_Spec §1, Component_Class_Design §2, §4.1 (v2.7):
// - be/ nuốt MỌI lỗi và trả 200 (mất webhook khi DB lỗi). Nay chỉ nuốt danh sách mã NT-PAY-1001 (không thấy giao
//   dịch), 1005 (sai số tiền, BR-09), 1009 (sai trạng thái); lỗi khác ném → 500 để PayOS gửi lại.
//   T3.9: khoá đơn bận → 503 NT-GEN-0503.
// - Tiền về (code '00') ghi sổ payment_transactions TRƯỚC khi xử lý, chốt outcome sau (ADR-0016).
// Route public ở gateway; service tự kiểm chữ ký bằng SDK. Không log counterAccount*, raw_payload (security §5).
import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Logger,
  Post,
} from '@nestjs/common';
import { BusinessException } from '@nextech/service-kit';
import { PayOS, WebhookError, type Webhook } from '@payos/node';
import { PAYOS_CLIENT } from '../../config/payos';
import type { LedgerOutcome } from '../../database/entities/payment-transaction.entity';
import { OrderLockBusyError } from '../../database/db-lock-error';
import { invalidWebhook, lockBusyRetryLater, PAY_ERROR } from '../../errors';
import { PaymentCoreService } from './payment-core.service';
import {
  PaymentLedgerService,
  type WebhookPayload,
} from './payment-ledger.service';

// Mã được nuốt (trả 200) và kết quả ghi sổ tương ứng; 1001 xảy ra khi giao dịch biến mất giữa findForWebhook và
// markSuccess — sổ đã ở nhánh unmatched nếu không thấy từ đầu
const SWALLOWED: Record<string, LedgerOutcome | null> = {
  [PAY_ERROR.NOT_FOUND]: null,
  [PAY_ERROR.AMOUNT_MISMATCH]: 'amount_mismatch',
  [PAY_ERROR.INVALID_STATE]: 'invalid_payment_state',
};

function swallowedCode(err: unknown): string | null {
  return err instanceof BusinessException && err.code in SWALLOWED
    ? err.code
    : null;
}

@Controller('webhooks/payos')
export class PayosWebhookController {
  private readonly logger = new Logger(PayosWebhookController.name);

  constructor(
    @Inject(PAYOS_CLIENT) private readonly payos: PayOS,
    private readonly paymentCore: PaymentCoreService,
    private readonly ledger: PaymentLedgerService,
  ) {}

  @Post()
  @HttpCode(200)
  async handle(@Body() body: Webhook) {
    // Thiếu / sai chữ ký → SDK ném WebhookError; trả 400 thay vì để lọt thành 500 (be/)
    let data: WebhookPayload;
    try {
      data = await this.payos.webhooks.verify(body);
    } catch (err) {
      if (err instanceof WebhookError) {
        this.logger.warn(`Webhook PayOS bị từ chối: ${err.message}`);
        throw invalidWebhook();
      }
      throw err;
    }

    if (data.code === '00') {
      await this.handlePaid(data, body.signature);
    } else {
      await this.handleNotPaid(data);
    }
    return { success: true };
  }

  private async handlePaid(data: WebhookPayload, signature: string) {
    const ledgerId = await this.ledger.record(data, signature);
    const found = await this.paymentCore.findForWebhook(data.orderCode);
    if (!found) {
      await this.ledger.settle(ledgerId, null, 'unmatched');
      // PayOS gửi lại cũng không giúp gì: đối soát tay theo dòng sổ
      this.logger.error(
        `Webhook PayOS không khớp giao dịch: orderCode=${data.orderCode} amount=${data.amount} ledger=${ledgerId}`,
      );
      return;
    }
    try {
      await this.paymentCore.markSuccess({
        found,
        orderCode: data.orderCode,
        paidAmount: data.amount,
        gatewayResponse: data,
        ledgerId,
      });
    } catch (err) {
      // Khoá đơn bận (BR-20, T3.9): 503 để PayOS gửi lại; sổ giữ 'received'. Poll và job cũng xác nhận được
      if (err instanceof OrderLockBusyError) {
        this.logger.warn(
          `Webhook PayOS: khoá đơn bận, trả 503: orderCode=${data.orderCode} ledger=${ledgerId}`,
        );
        throw lockBusyRetryLater();
      }
      const code = swallowedCode(err);
      if (!code) throw err; // DB lỗi: sổ giữ 'received', PayOS gửi lại
      const outcome = SWALLOWED[code];
      // Chốt sau rollback của markSuccess, câu riêng; controller đã biết payment_id (v2.6)
      if (outcome) await this.ledger.settle(ledgerId, found.id, outcome);
      this.logger.warn(
        `Webhook PayOS ${code}: orderCode=${data.orderCode} amount=${data.amount} ledger=${ledgerId}`,
      );
    }
  }

  // Không phải tiền về: không ghi sổ, markFailed như be/
  private async handleNotPaid(data: WebhookPayload) {
    try {
      await this.paymentCore.markFailed({
        transactionId: String(data.orderCode),
        gatewayResponse: data,
      });
    } catch (err) {
      const code = swallowedCode(err);
      if (!code) throw err;
      this.logger.warn(`Webhook PayOS ${code}: orderCode=${data.orderCode}`);
    }
  }
}
