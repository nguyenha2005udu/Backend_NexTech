// Saga đặt hàng (NT.CHECKOUT_SAGA Component_Class_Design §1). T3.3: checkout + các bước tiến.
// T3.4: CompensationService (export cho huỷ đơn, đối soát). ReconcileJob, OrderCancelService (T3.5).
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClientsModule } from '../../clients/clients.module';
import { Cart } from '../../database/entities/cart.entity';
import { Order } from '../../database/entities/order.entity';
import { SagaTask } from '../../database/entities/saga-task.entity';
import { CheckoutSagaService } from './checkout-saga.service';
import { CheckoutController } from './checkout.controller';
import { CheckoutService } from './checkout.service';
import { CompensationService } from './compensation.service';

@Module({
  imports: [TypeOrmModule.forFeature([Cart, Order, SagaTask]), ClientsModule],
  controllers: [CheckoutController],
  providers: [CheckoutService, CheckoutSagaService, CompensationService],
  exports: [CompensationService],
})
export class CheckoutModule {}
