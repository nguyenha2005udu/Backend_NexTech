import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  HealthModule,
  rabbitHealthCheck,
  typeOrmHealthCheck,
} from '@nextech/service-kit';
import configuration from './config/configuration';
import { dataSourceOptions } from './database/typeorm-options';
import { EventsConsumer } from './modules/events/events.consumer';
import { EventsModule } from './modules/events/events.module';
import { NotificationModule } from './modules/notification/notification.module';

// Khung T1.6. T4.2: 4 route đọc thông báo, consumer sự kiện. T4.3: thử lại, DLQ (RabbitConsumer của service-kit).
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    // Chạy migration khi khởi động, không synchronize (coding-convention §5)
    TypeOrmModule.forRootAsync({
      useFactory: () => ({ ...dataSourceOptions(), migrationsRun: true }),
    }),
    // RabbitMQ chết: API đọc vẫn chạy, /health chỉ báo trạng thái (NT.NOTIFICATION Processing_Flow §3)
    HealthModule.forRoot({
      service: 'notification',
      checks: [typeOrmHealthCheck(), rabbitHealthCheck(EventsConsumer)],
    }),
    NotificationModule,
    EventsModule,
  ],
})
export class AppModule {}
