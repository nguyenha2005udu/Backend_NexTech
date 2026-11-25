import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import type { NotificationType } from '../../database/entities/notification.entity';

// Chép từ users/notification/notification.dto.ts của source cũ. Mới: `limit` tối đa 100 (NT.NOTIFICATION v1.1).
// GET /api/notifications
export class QueryNotificationDto {
  @IsOptional()
  @IsIn(['price_alert', 'deal', 'recommendation', 'order_update', 'system'])
  type?: NotificationType;

  // 'true' = chỉ lấy thông báo chưa đọc. Query string nên nhận chuỗi.
  @IsOptional()
  @IsIn(['true', 'false'])
  unread?: string;

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
