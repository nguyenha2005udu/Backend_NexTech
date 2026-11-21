// Từ be/src/admin/payment/payment.admin.module.ts. PaymentCoreService (confirmCod), PaymentLedgerService
// (transactions) từ PaymentModule.
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Payment } from '../../database/entities/payment.entity';
import { PaymentModule } from '../payment/payment.module';
import { AdminPaymentController } from './payment.admin.controller';
import { AdminPaymentService } from './payment.admin.service';

@Module({
  imports: [TypeOrmModule.forFeature([Payment]), PaymentModule],
  controllers: [AdminPaymentController],
  providers: [AdminPaymentService],
})
export class AdminPaymentModule {}
