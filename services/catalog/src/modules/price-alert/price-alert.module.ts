// Chép từ be/src/users/pricealert/pricealert.module.ts. Bỏ MailModule: cron không gửi email nữa
// (T4.4 phát sự kiện price.alert.triggered, notification-service gửi — Processing_Flow §4).
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PriceAlert } from '../../database/entities/price-alert.entity';
import { Product } from '../../database/entities/product.entity';
import { ProductImage } from '../../database/entities/product-image.entity';
import { PriceAlertController } from './price-alert.controller';
import { PriceAlertService } from './price-alert.service';

@Module({
  imports: [TypeOrmModule.forFeature([PriceAlert, Product, ProductImage])],
  controllers: [PriceAlertController],
  providers: [PriceAlertService],
})
export class PriceAlertModule {}
