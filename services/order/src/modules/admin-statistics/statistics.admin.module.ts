// Thống kê tổng quan (NT.ORDER route 12), tách từ be/src/admin/statistics. Đơn đọc order_db, doanh thu qua
// PaymentCoreService, sản phẩm và người dùng qua client (Component_Class_Design §6).
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClientsModule } from '../../clients/clients.module';
import { Order } from '../../database/entities/order.entity';
import { PaymentModule } from '../payment/payment.module';
import { AdminStatisticsController } from './statistics.admin.controller';
import { AdminStatisticsService } from './statistics.admin.service';

@Module({
  imports: [TypeOrmModule.forFeature([Order]), PaymentModule, ClientsModule],
  controllers: [AdminStatisticsController],
  providers: [AdminStatisticsService],
})
export class AdminStatisticsModule {}
