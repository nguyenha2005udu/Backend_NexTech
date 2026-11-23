// Module NGỌN (NT.ORDER_HOLD §1, §4): chỉ app.module import; dùng checkout (huỷ), payment (ghi nhận tiền, PayOS),
// order-hold (hẹn). Không module nào import ngược lại → không cần forwardRef (test #25).
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from '../../database/entities/order.entity';
import { Payment } from '../../database/entities/payment.entity';
import { CheckoutModule } from '../checkout/checkout.module';
import { OrderHoldModule } from '../order-hold/order-hold.module';
import { PaymentModule } from '../payment/payment.module';
import { HoldExpiryJob } from './hold-expiry.job';
import { HoldExpiryService } from './hold-expiry.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, Payment]),
    CheckoutModule,
    PaymentModule,
    OrderHoldModule,
  ],
  providers: [HoldExpiryService, HoldExpiryJob],
})
export class HoldExpiryModule {}
