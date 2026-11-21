// Saga đặt hàng (NT.CHECKOUT_SAGA Component_Class_Design §1). T3.3: checkout + các bước tiến.
// T3.4: CompensationService. T3.5: ReconcileJob (cron đối soát), OrderCancelService (export cho admin huỷ).
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClientsModule } from '../../clients/clients.module';
import { Cart } from '../../database/entities/cart.entity';
import { Order } from '../../database/entities/order.entity';
import { OrderItem } from '../../database/entities/order-item.entity';
import { SagaTask } from '../../database/entities/saga-task.entity';
import { CheckoutSagaService } from './checkout-saga.service';
import { CheckoutController } from './checkout.controller';
import { CheckoutService } from './checkout.service';
import { CompensationService } from './compensation.service';
import { OrderCancelService } from './order-cancel.service';
import { ReconcileJob } from './reconcile.job';

@Module({
  imports: [
    TypeOrmModule.forFeature([Cart, Order, OrderItem, SagaTask]),
    ClientsModule,
  ],
  controllers: [CheckoutController],
  providers: [
    CheckoutService,
    CheckoutSagaService,
    CompensationService,
    OrderCancelService,
    ReconcileJob,
  ],
  exports: [CompensationService, OrderCancelService],
})
export class CheckoutModule {}
