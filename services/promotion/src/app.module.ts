import { Logger, Module, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { HealthModule, typeOrmHealthCheck } from '@nextech/service-kit';
import configuration from './config/configuration';
import { seedDemo } from './database/seed';
import { dataSourceOptions } from './database/typeorm-options';
import { DiscountCodeModule } from './modules/discount-code/discount-code.module';
import { AdminDiscountCodeModule } from './modules/admin-discount-code/discount-code.admin.module';
import { RedemptionModule } from './modules/redemption/redemption.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    // Chạy migration khi khởi động, không synchronize (coding-convention §5)
    TypeOrmModule.forRootAsync({
      useFactory: () => ({ ...dataSourceOptions(), migrationsRun: true }),
    }),
    HealthModule.forRoot({
      service: 'promotion',
      checks: [typeOrmHealthCheck()],
    }),
    DiscountCodeModule,
    AdminDiscountCodeModule,
    RedemptionModule,
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
    this.logger.log(`Seed demo: thêm ${added} mã giảm giá`);
  }
}
