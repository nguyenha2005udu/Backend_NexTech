// Chép nguyên từ be/src/users/product/product.dto.ts
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

// GET /api/products
export class QueryProductDto {
  @IsOptional()
  @IsString()
  search?: string; // tìm theo tên sản phẩm

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  // Lọc theo hãng, vd: ?brand=Apple
  @IsOptional()
  @IsString()
  brand?: string;

  // Lọc theo tag, vd: ?tag=sinh vien
  @IsOptional()
  @IsString()
  tag?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxPrice?: number;

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

// ---------- GET /api/products/:id/reviews ----------
export class QueryProductReviewDto {
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

// ---------- POST /api/products/:id/reviews ----------
export class CreateProductReviewDto {
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(5)
  rating: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  content?: string;
}
