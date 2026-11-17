// Chép từ be/src/admin/category/category.admin.controller.ts. Đổi guard: JwtAccessGuard → GatewayUserGuard;
// RolesGuard, @Roles từ service-kit.
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminCategoryService } from './category.admin.service';
import {
  CreateCategoryDto,
  UpdateCategoryDto,
  QueryCategoryDto,
} from './category.admin.dto';
import { GatewayUserGuard, Roles, RolesGuard } from '@nextech/service-kit';

@Controller('admin/categories')
@UseGuards(GatewayUserGuard, RolesGuard)
@Roles('admin')
export class AdminCategoryController {
  constructor(private readonly adminCategoryService: AdminCategoryService) {}

  @Get()
  findAll(@Query() query: QueryCategoryDto) {
    return this.adminCategoryService.findAllForAdmin(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.adminCategoryService.findOneOrFail(id);
  }

  @Post()
  create(@Body() dto: CreateCategoryDto) {
    return this.adminCategoryService.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCategoryDto) {
    return this.adminCategoryService.update(id, dto);
  }

  // Xoá mềm
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.adminCategoryService.remove(id);
  }

  // Xoá cứng khỏi DB
  @Delete(':id/hard')
  hardRemove(@Param('id') id: string) {
    return this.adminCategoryService.hardRemove(id);
  }
}
