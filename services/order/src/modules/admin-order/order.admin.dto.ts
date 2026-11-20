// Chép từ be/src/admin/order/order.admin.dto.ts. Trạng thái đổi sang bộ mới (Component_Class_Design §2).
// UpdateOrderStatusDto chỉ nhận shipped, cancelled (API_Spec §1 route 11 bước 1, sổ A1): tiền đi qua
// confirm-cod / webhook, không đặt `paid` tay. Sai → ValidationPipe trả 400 NT-GEN-0001.
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import type { OrderStatus } from '../../database/entities/order.entity';
import { ORDER_STATUSES } from '../order/order.dto';

// GET /api/admin/orders
export class QueryAdminOrderDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(ORDER_STATUSES)
  status?: OrderStatus;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

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

// PUT /api/admin/orders/:id/status
export class UpdateOrderStatusDto {
  @IsIn(['shipped', 'cancelled'])
  status: 'shipped' | 'cancelled';
}
