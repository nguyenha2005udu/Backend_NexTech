import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthModule, typeOrmHealthCheck } from '@nextech/service-kit';
import configuration from './config/configuration';
import { dataSourceOptions } from './database/typeorm-options';

// Khung T1.6: khởi động, kết nối database, /health. Module nghiệp vụ thêm ở task sau
// (implementation/PHASE-1.md#T1.6).
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
  ],
})
export class AppModule {}
