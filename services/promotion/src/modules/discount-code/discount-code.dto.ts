import { Type } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  MaxLength,
  IsInt,
} from 'class-validator';

// Chép nguyên từ be/src/users/discountcode/discountcode.dto.ts

// POST /api/discount-codes/validate
export class ValidateDiscountCodeDto {
  @IsString()
  @MaxLength(50)
  code: string;

  // Tổng giá trị đơn hàng hiện tại, dùng để kiểm tra min_order_value và tính discount_amount
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  order_value: number;

  // Phí ship hiện tại của đơn hàng, dùng để tính discount_amount khi discount_type = free_shipping
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  shipping_fee?: number = 0;
}

// GET /api/discount-codes and GET /api/discount-codes/freeship
export class ListDiscountCodeDto {
  // Nếu truyền, chỉ trả về các mã mà user hiện đủ điều kiện dùng
  // (order_value >= min_order_value). Không truyền thì trả về tất cả mã đang active.
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  order_value?: number;

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
