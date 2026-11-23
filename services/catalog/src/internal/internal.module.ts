import { Module } from '@nestjs/common';
import { ProductModule } from '../modules/product/product.module';
import { StockModule } from '../modules/stock/stock.module';
import { ProductsInternalController } from './products.internal.controller';
import { ProductsInternalService } from './products.internal.service';
import { StatsInternalController } from './stats.internal.controller';
import { StockInternalController } from './stock.internal.controller';

// Mọi /internal/* của catalog (NT.CATALOG API_Spec §2). search, facets cho trợ lý (T8.4).
@Module({
  imports: [StockModule, ProductModule],
  controllers: [
    StockInternalController,
    ProductsInternalController,
    StatsInternalController,
  ],
  providers: [ProductsInternalService],
})
export class InternalModule {}
