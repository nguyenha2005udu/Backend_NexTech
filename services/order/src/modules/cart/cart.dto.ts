// Chép nguyên từ be/src/users/cart/cart.dto.ts
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Min } from 'class-validator';

// POST /api/cart/items
export class AddCartItemDto {
  @IsUUID()
  product_id: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity?: number = 1;
}

// PUT /api/cart/items/:id
export class UpdateCartItemDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity: number;
}
