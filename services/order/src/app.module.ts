import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  HealthModule,
  redisHealthCheck,
  typeOrmHealthCheck,
} from '@nextech/service-kit';
import configuration from './config/configuration';
import {
  appConnectionExtra,
  dataSourceOptions,
} from './database/typeorm-options';
import { InternalModule } from './internal/internal.module';
import { AdminPaymentModule } from './modules/admin-payment/payment.admin.module';
import { AdminRevenueModule } from './modules/admin-revenue/revenue.admin.module';
import { AdminStatisticsModule } from './modules/admin-statistics/statistics.admin.module';
import { AdminOrderModule } from './modules/admin-order/order.admin.module';
import { CartModule } from './modules/cart/cart.module';
import { CheckoutModule } from './modules/checkout/checkout.module';
import { OrderModule } from './modules/order/order.module';
import { PaymentModule } from './modules/payment/payment.module';
import { HoldExpiryModule } from './modules/hold-expiry/hold-expiry.module';
import { ORDER_REDIS, RedisModule } from './redis/redis.module';

// Khung T1.6: khởi động, kết nối database, /health. T3.1: giỏ hàng. T3.2: xem đơn, admin đơn,
// /internal/purchases. T3.3: checkout (saga). T3.5: cron đối soát, huỷ đơn. T3.6: thanh toán. T3.7: thống kê tổng quan. T3.9: Redis, khoá đơn. T3.10: hạn giữ hàng. Module khác thêm ở task sau
// (implementation/PHASE-3.md).
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    // Cron đối soát saga (ReconcileJob), như catalog
    ScheduleModule.forRoot(),
    // Chạy migration khi khởi động, không synchronize (coding-convention §5)
    TypeOrmModule.forRootAsync({
      // extra: lock_timeout, idle_in_transaction_session_timeout chỉ cho kết nối ứng dụng (BR-20, T3.9)
      useFactory: () => ({
        ...dataSourceOptions(),
        extra: appConnectionExtra(),
        migrationsRun: true,
      }),
    }),
    // Client Redis lỗi nhanh + OrderLockService (T3.9, NT.ORDER_HOLD §1, §2)
    RedisModule,
    // Redis chỉ báo trạng thái, không làm /health 503: khoá đơn fail-open khi Redis lỗi (ADR-0015)
    HealthModule.forRoot({
      service: 'order',
      checks: [
        typeOrmHealthCheck(),
        { ...redisHealthCheck(ORDER_REDIS), required: false },
      ],
    }),
    CartModule,
    OrderModule,
    CheckoutModule,
    AdminOrderModule,
    PaymentModule,
    AdminPaymentModule,
    AdminRevenueModule,
    AdminStatisticsModule,
    // Job huỷ đơn quá hạn giữ hàng (T3.10, BR-19) — module ngọn
    HoldExpiryModule,
    InternalModule,
  ],
})
export class AppModule {}
