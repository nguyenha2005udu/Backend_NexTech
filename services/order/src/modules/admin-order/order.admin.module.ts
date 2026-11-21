// Từ be/src/admin/order/order.admin.module.ts. PaymentCoreService (confirmCodByOrder) nối ở T3.6.
// T3.5: huỷ đơn qua OrderCancelService (CheckoutModule export).
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from '../../database/entities/order.entity';
import { CheckoutModule } from '../checkout/checkout.module';
import { AdminOrderController } from './order.admin.controller';
import { AdminOrderService } from './order.admin.service';

@Module({
  imports: [TypeOrmModule.forFeature([Order]), CheckoutModule],
  controllers: [AdminOrderController],
  providers: [AdminOrderService],
})
export class AdminOrderModule {}
