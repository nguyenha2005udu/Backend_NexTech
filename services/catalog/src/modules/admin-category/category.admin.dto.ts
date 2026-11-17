// Chép từ be/src/admin/category/category.admin.dto.ts. Đổi: ToBoolean lấy từ @nextech/service-kit (v1.4)
import { PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import { ToBoolean } from '@nextech/service-kit';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Max,
  Min,
  MinLength,
} from 'class-validator';

// POST /api/admin/categories
export class CreateCategoryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  icon?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsUUID()
  industryId?: string;
}

// PATCH /api/admin/categories/:id
export class UpdateCategoryDto extends PartialType(CreateCategoryDto) {}

// GET /api/admin/categories
export class QueryCategoryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsUUID()
  industryId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
