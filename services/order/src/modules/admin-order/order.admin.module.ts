// Từ be/src/admin/order/order.admin.module.ts. T3.6: PaymentCoreService.confirmCodByOrder khi giao COD.
// T3.5: huỷ đơn qua OrderCancelService (CheckoutModule export).
import { Module } from '@nestjs/common';
import { OrderHoldModule } from '../order-hold/order-hold.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from '../../database/entities/order.entity';
import { CheckoutModule } from '../checkout/checkout.module';
import { PaymentModule } from '../payment/payment.module';
import { AdminOrderController } from './order.admin.controller';
import { AdminOrderService } from './order.admin.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order]),
    CheckoutModule,
    PaymentModule,
    OrderHoldModule,
  ],
  controllers: [AdminOrderController],
  providers: [AdminOrderService],
})
export class AdminOrderModule {}
