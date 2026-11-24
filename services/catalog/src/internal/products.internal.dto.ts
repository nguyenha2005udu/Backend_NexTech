import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

// Body POST /internal/products/batch (NT.CATALOG API_Spec §2).
// Tối đa 100 id (non-functional-standards §1: chặn trên ngay từ thiết kế). Mẫu: identity UsersBatchDto.
export class ProductsBatchDto {
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  ids: string[];
}

export const SEARCH_MAX_LIMIT = 6;

// Query GET /internal/products/search (NT.CATALOG API_Spec §2, T8.4). Trợ lý AI gọi.
// Cùng bộ lọc với GET /api/products; limit mặc định 6, tối đa 6.
export class SearchProductsInternalDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  brand?: string;

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

  /** Lớn hơn 6 thì chặn còn 6 (không báo lỗi) */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}
