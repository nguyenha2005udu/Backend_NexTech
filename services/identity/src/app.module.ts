import { Logger, Module, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  HealthModule,
  redisHealthCheck,
  typeOrmHealthCheck,
} from '@nextech/service-kit';
import configuration from './config/configuration';
import { seedDemo } from './database/seed';
import { dataSourceOptions } from './database/typeorm-options';
import { REDIS_CLIENT, RedisModule } from './redis/redis.module';
import { AuthModule } from './modules/auth/auth.module';
import { ProfileModule } from './modules/profile/profile.module';
import { AddressModule } from './modules/address/address.module';
import { ProfileAdminModule } from './modules/admin-profile/profile.admin.module';
import { InternalModule } from './internal/internal.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    // Chạy migration khi khởi động, không synchronize (coding-convention §5)
    TypeOrmModule.forRootAsync({
      useFactory: () => ({ ...dataSourceOptions(), migrationsRun: true }),
    }),
    RedisModule,
    // Redis giữ OTP và refresh token: chết thì đăng nhập, refresh không chạy được → /health 503
    HealthModule.forRoot({
      service: 'identity',
      checks: [typeOrmHealthCheck(), redisHealthCheck(REDIS_CLIENT)],
    }),
    AuthModule,
    ProfileModule,
    AddressModule,
    ProfileAdminModule,
    InternalModule,
  ],
})
export class AppModule implements OnApplicationBootstrap {
  private readonly logger = new Logger(AppModule.name);

  constructor(
    private readonly config: ConfigService,
    private readonly dataSource: DataSource,
  ) {}

  async onApplicationBootstrap() {
    if (!this.config.get<boolean>('seedDemo')) return;
    const added = await seedDemo(this.dataSource);
    this.logger.log(`Seed demo: thêm ${added} tài khoản`);
  }
}
