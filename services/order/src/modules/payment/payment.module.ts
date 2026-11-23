// Từ be/src/users/payment/payment.module.ts (NT.PAYMENT Component_Class_Design §1). Export PaymentCoreService cho
// huỷ đơn (voidPendingByOrder), admin giao COD (confirmCodByOrder), admin giao dịch, thống kê (sumRevenue — T3.7);
// PaymentLedgerService cho admin chi tiết (transactions).
import { Module } from '@nestjs/common';
import { OrderHoldModule } from '../order-hold/order-hold.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PAYOS_CLIENT, PayosProvider } from '../../config/payos';
import { Order } from '../../database/entities/order.entity';
import { Payment } from '../../database/entities/payment.entity';
import { PaymentCoreService } from './payment-core.service';
import { PaymentLedgerService } from './payment-ledger.service';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { PayosWebhookController } from './payos-webhook.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Order, Payment]), OrderHoldModule],
  controllers: [PaymentController, PayosWebhookController],
  providers: [
    PayosProvider,
    PaymentService,
    PaymentCoreService,
    PaymentLedgerService,
  ],
  // PAYOS_CLIENT: HoldExpiryService hỏi PayOS trước khi huỷ đơn quá hạn (T3.10)
  exports: [PaymentCoreService, PaymentLedgerService, PAYOS_CLIENT],
})
export class PaymentModule {}
