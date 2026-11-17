// Chép từ be/src/users/industry/industry.module.ts. Bỏ Category, ProductImage: service không còn inject.
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Industry } from '../../database/entities/industry.entity';
import { Product } from '../../database/entities/product.entity';
import { IndustryController } from './industry.controller';
import { IndustryService } from './industry.service';

@Module({
  imports: [TypeOrmModule.forFeature([Industry, Product])],
  controllers: [IndustryController],
  providers: [IndustryService],
})
export class IndustryModule {}
