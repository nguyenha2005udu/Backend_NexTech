// Doanh thu theo kỳ (NT.PAYMENT route 7), tách từ be/src/admin/statistics vì đọc payments trong order_db.
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Payment } from '../../database/entities/payment.entity';
import { AdminRevenueController } from './revenue.admin.controller';
import { RevenueService } from './revenue.admin.service';

@Module({
  imports: [TypeOrmModule.forFeature([Payment])],
  controllers: [AdminRevenueController],
  providers: [RevenueService],
})
export class AdminRevenueModule {}
