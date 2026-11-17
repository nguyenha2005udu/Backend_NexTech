// Chép nguyên từ be/src/admin/category/category.admin.module.ts (chỉ đổi đường dẫn entity)
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Category } from '../../database/entities/category.entity';
import { Industry } from '../../database/entities/industry.entity';
import { AdminCategoryService } from './category.admin.service';
import { AdminCategoryController } from './category.admin.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Category, Industry])],
  controllers: [AdminCategoryController],
  providers: [AdminCategoryService],
})
export class AdminCategoryModule {}
