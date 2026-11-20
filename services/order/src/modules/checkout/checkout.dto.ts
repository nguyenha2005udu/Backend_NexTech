// Chép nguyên CreateOrderDto từ be/src/users/order/order.dto.ts (NT.CHECKOUT_SAGA API_Spec §1).
import {
  ArrayNotEmpty,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

// POST /api/orders
export class CreateOrderDto {
  @IsUUID('4', { message: 'address_id không hợp lệ' })
  address_id: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  discount_code?: string;

  // Mã giảm giá loại free_shipping, dùng song song với discount_code
  @IsOptional()
  @IsString()
  @MaxLength(50)
  freeship_code?: string;

  @IsOptional()
  @IsString()
  note?: string;

  // Danh sách cart_item được tick chọn ở màn Giỏ hàng. Bỏ trống = đặt cả giỏ.
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty({ message: 'Chưa chọn sản phẩm nào để đặt hàng' })
  @IsUUID('4', { each: true, message: 'cart_item_ids không hợp lệ' })
  cart_item_ids?: string[];
}
