import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

// Body POST /internal/stock-reservations (NT.CATALOG API_Spec §2). Sai → 400 NT-GEN-0001 (ValidationPipe).

export class ReserveItemDto {
  // Chữ thường: Postgres so uuid không phân biệt hoa/thường, còn @ArrayUnique và thứ tự khoá
  // (sắp chuỗi trong StockReservationService) thì có. Không chuẩn hoá thì cùng sản phẩm khác
  // hoa/thường lọt qua kiểm trùng (ra 409 NT-GEN thay vì 400), thứ tự khoá lệch với release.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @IsUUID()
  product_id: string;

  @IsInt()
  @Min(1)
  quantity: number;
}

export class ReserveStockDto {
  @IsUUID()
  order_id: string;

  // Tối đa 100 khớp batch; order gộp dòng giỏ theo sản phẩm nên không gửi trùng
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique((i: ReserveItemDto) => i.product_id)
  @ValidateNested({ each: true })
  @Type(() => ReserveItemDto)
  items: ReserveItemDto[];
}
