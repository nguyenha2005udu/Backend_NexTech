// Chép QueryOrderDto từ be/src/users/order/order.dto.ts. `status` đổi sang trạng thái mới
// (bỏ simulated_success, thêm processing, failed — NT.ORDER Component_Class_Design §2).
// CreateOrderDto thêm ở T3.3 (modules/checkout).
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import type { OrderStatus } from '../../database/entities/order.entity';

export const ORDER_STATUSES: OrderStatus[] = [
  'processing',
  'pending',
  'paid',
  'shipped',
  'cancelled',
  'failed',
];

// GET /api/orders
export class QueryOrderDto {
  @IsOptional()
  @IsIn(ORDER_STATUSES)
  status?: OrderStatus;

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
