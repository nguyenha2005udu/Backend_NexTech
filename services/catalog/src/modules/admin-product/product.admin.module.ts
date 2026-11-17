// Chép từ be/src/admin/product/product.admin.module.ts (chỉ đổi đường dẫn import)
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Product } from '../../database/entities/product.entity';
import { ProductImage } from '../../database/entities/product-image.entity';
import { ProductSpec } from '../../database/entities/product-spec.entity';
import { ProductReview } from '../../database/entities/product-review.entity';
import { Tag } from '../../database/entities/tag.entity';
import { AdminProductService } from './product.admin.service';
import { AdminProductController } from './product.admin.controller';
import { CloudinaryModule } from '../../cloudinary/cloudinary.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Product,
      ProductImage,
      ProductSpec,
      ProductReview,
      Tag,
    ]),
    CloudinaryModule,
  ],
  controllers: [AdminProductController],
  providers: [AdminProductService],
})
export class AdminProductModule {}
