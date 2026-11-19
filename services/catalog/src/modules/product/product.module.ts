// Chép từ be/src/users/product/product.module.ts. Bỏ OrderItem (order-service); thêm ClientsModule cho
// createReview (OrderClient, IdentityClient — T2.5).
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Product } from '../../database/entities/product.entity';
import { ProductReview } from '../../database/entities/product-review.entity';
import { ProductService } from './product.service';
import { ProductController } from './product.controller';
import { ClientsModule } from '../../clients/clients.module';

@Module({
  imports: [TypeOrmModule.forFeature([Product, ProductReview]), ClientsModule],
  controllers: [ProductController],
  providers: [ProductService],
  exports: [ProductService],
})
export class ProductModule {}
