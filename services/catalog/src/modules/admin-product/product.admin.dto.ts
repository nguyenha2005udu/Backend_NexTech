// Chép nguyên từ be/src/admin/product/product.admin.dto.ts (giữ hàm toBoolean cục bộ: chuỗi lạ → false, khác ToBoolean)
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  MaxLength,
} from 'class-validator';

const toBoolean = ({ value }: { value: unknown }) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  return value;
};

// GET /api/admin/products
export class QueryAdminProductDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsString()
  brand?: string;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsIn(['price_asc', 'price_desc', 'rating_desc', 'newest'])
  sort?: 'price_asc' | 'price_desc' | 'rating_desc' | 'newest';

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

// POST /api/admin/products
export class CreateProductDto {
  @IsString()
  @MaxLength(255)
  name: string;

  @IsOptional()
  @IsUUID()
  category_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  brand?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  stock_quantity?: number = 0;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean = true;
}

// PUT /api/admin/products/:id
export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsUUID()
  category_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  brand?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price?: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  stock_quantity?: number;
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

// POST /api/admin/products/:id/images
export class CreateProductImageDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  image_url?: string;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  is_primary?: boolean = false;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sort_order?: number = 0;
}

// PUT /api/admin/products/:id/images/:image_id
export class UpdateProductImageDto {
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  is_primary?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sort_order?: number;
}

// POST /api/admin/products/:id/specs
export class CreateProductSpecDto {
  @IsString()
  @MaxLength(100)
  spec_key: string;

  @IsString()
  @MaxLength(500)
  spec_value: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  spec_unit?: string;
}

// PUT /api/admin/products/:id/specs/:spec_id
export class UpdateProductSpecDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  spec_key?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  spec_value?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  spec_unit?: string;
}

// POST /api/admin/products/:id/tags
export class CreateProductTagDto {
  @IsString()
  @MaxLength(100)
  tag: string;
}
