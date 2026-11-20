import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthModule, typeOrmHealthCheck } from '@nextech/service-kit';
import configuration from './config/configuration';
import { dataSourceOptions } from './database/typeorm-options';
import { InternalModule } from './internal/internal.module';
import { AdminOrderModule } from './modules/admin-order/order.admin.module';
import { CartModule } from './modules/cart/cart.module';
import { CheckoutModule } from './modules/checkout/checkout.module';
import { OrderModule } from './modules/order/order.module';

// Khung T1.6: khởi động, kết nối database, /health. T3.1: giỏ hàng. T3.2: xem đơn, admin đơn,
// /internal/purchases. T3.3: checkout (saga). Module khác thêm ở task sau (implementation/PHASE-3.md).
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    // Chạy migration khi khởi động, không synchronize (coding-convention §5)
    TypeOrmModule.forRootAsync({
      useFactory: () => ({ ...dataSourceOptions(), migrationsRun: true }),
    }),
    HealthModule.forRoot({
      service: 'order',
      checks: [typeOrmHealthCheck()],
    }),
    CartModule,
    OrderModule,
    CheckoutModule,
    AdminOrderModule,
    InternalModule,
  ],
})
export class AppModule {}
