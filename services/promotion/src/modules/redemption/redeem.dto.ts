import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

// POST /internal/redemptions (NT.PROMOTION API_Spec §2). API nội bộ mới, order-service gọi.
// Tiền là số nguyên VND (api-convention §8). Độ dài mã giống ValidateDiscountCodeDto của be/.
export class RedeemDto {
  @IsUUID()
  order_id: string;

  @IsInt()
  @Min(0)
  subtotal: number;

  @IsInt()
  @Min(0)
  shipping_fee: number;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  discount_code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  freeship_code?: string;
}
