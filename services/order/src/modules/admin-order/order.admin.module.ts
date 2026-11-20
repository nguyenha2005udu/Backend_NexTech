// Từ be/src/admin/order/order.admin.module.ts. PaymentCoreService (confirmCodByOrder) nối ở T3.6,
// OrderCancelService ở T3.5.
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from '../../database/entities/order.entity';
import { AdminOrderController } from './order.admin.controller';
import { AdminOrderService } from './order.admin.service';

@Module({
  imports: [TypeOrmModule.forFeature([Order])],
  controllers: [AdminOrderController],
  providers: [AdminOrderService],
})
export class AdminOrderModule {}
