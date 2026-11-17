// Chép nguyên từ be/src/admin/discountcode/discountcode.admin.dto.ts
import { Type } from 'class-transformer';
import { ToBoolean } from '@nextech/service-kit';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  MaxLength,
} from 'class-validator';

// GET /api/admin/discount-codes
export class QueryDiscountCodeDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(['order', 'free_shipping'])
  category?: 'order' | 'free_shipping';

  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsIn(['running', 'paused'])
  status?: 'running' | 'paused';

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

// POST /api/admin/discount-codes
export class CreateDiscountCodeDto {
  @IsString()
  @MaxLength(50)
  code: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @IsOptional()
  @IsIn(['order', 'free_shipping'])
  category?: 'order' | 'free_shipping' = 'order';

  @IsIn(['percent', 'fixed_amount'])
  discount_type: 'percent' | 'fixed_amount';

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  discount_value: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  min_order_value?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  max_discount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  usage_limit?: number;

  @IsOptional()
  @IsDateString()
  valid_from?: string;

  @IsOptional()
  @IsDateString()
  valid_until?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

// PUT /api/admin/discount-codes/:id
export class UpdateDiscountCodeDto {
  @IsOptional()
  @IsIn(['order', 'free_shipping'])
  category?: 'order' | 'free_shipping';

  @IsOptional()
  @IsIn(['percent', 'fixed_amount'])
  discount_type?: 'percent' | 'fixed_amount';

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  discount_value?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  min_order_value?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  max_discount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  usage_limit?: number;

  @IsOptional()
  @IsDateString()
  valid_from?: string;

  @IsOptional()
  @IsDateString()
  valid_until?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
