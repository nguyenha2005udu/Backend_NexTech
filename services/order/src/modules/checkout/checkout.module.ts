// Saga đặt hàng (NT.CHECKOUT_SAGA Component_Class_Design §1). T3.3: checkout + các bước tiến.
// CompensationService (T3.4), ReconcileJob, OrderCancelService (T3.5) thêm vào đây.
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClientsModule } from '../../clients/clients.module';
import { Cart } from '../../database/entities/cart.entity';
import { Order } from '../../database/entities/order.entity';
import { CheckoutSagaService } from './checkout-saga.service';
import { CheckoutController } from './checkout.controller';
import { CheckoutService } from './checkout.service';

@Module({
  imports: [TypeOrmModule.forFeature([Cart, Order]), ClientsModule],
  controllers: [CheckoutController],
  providers: [CheckoutService, CheckoutSagaService],
})
export class CheckoutModule {}
