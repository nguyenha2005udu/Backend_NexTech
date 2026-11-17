// Chép nguyên từ be/src/users/category/category.controller.ts (chỉ đổi đường dẫn entity)
import { Controller, Get, Param, Query } from '@nestjs/common';
import { CategoryService } from './category.service';
import { CategoryProductsQueryDto } from './category.dto';

@Controller('categories')
export class CategoryController {
  constructor(private readonly categoryService: CategoryService) {}

  // GET /api/categories - danh sách danh mục đang hoạt động
  @Get()
  findAll() {
    return this.categoryService.findAllActive();
  }

  // GET /api/categories/:id
  @Get(':id')
  findOne(@Param('id') id: string, @Query() query: CategoryProductsQueryDto) {
    return this.categoryService.findOneActive(id, query);
  }
}
