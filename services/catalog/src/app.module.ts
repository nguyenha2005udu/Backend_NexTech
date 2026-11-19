import { Logger, Module, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { HealthModule, typeOrmHealthCheck } from '@nextech/service-kit';
import configuration from './config/configuration';
import { seedDemo } from './database/seed';
import { dataSourceOptions } from './database/typeorm-options';
import { ProductModule } from './modules/product/product.module';
import { CategoryModule } from './modules/category/category.module';
import { IndustryModule } from './modules/industry/industry.module';
import { AdminProductModule } from './modules/admin-product/product.admin.module';
import { AdminCategoryModule } from './modules/admin-category/category.admin.module';
import { StockModule } from './modules/stock/stock.module';
import { InternalModule } from './internal/internal.module';
import { PriceAlertModule } from './modules/price-alert/price-alert.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    // Chạy migration khi khởi động, không synchronize (coding-convention §5)
    TypeOrmModule.forRootAsync({
      useFactory: () => ({ ...dataSourceOptions(), migrationsRun: true }),
    }),
    // Cron theo dõi giá (PRICE_ALERT_CRON, T2.5)
    ScheduleModule.forRoot(),
    // RabbitMQ (T4.1) chỉ báo trạng thái, không làm /health 503 (reliability-standard §5)
    HealthModule.forRoot({
      service: 'catalog',
      checks: [typeOrmHealthCheck()],
    }),
    ProductModule,
    CategoryModule,
    IndustryModule,
    AdminProductModule,
    AdminCategoryModule,
    StockModule,
    InternalModule,
    PriceAlertModule,
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
    this.logger.log(`Seed demo: thêm ${added} sản phẩm`);
  }
}
