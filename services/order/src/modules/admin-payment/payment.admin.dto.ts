// Chép nguyên be/src/admin/payment/payment.admin.dto.ts
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

// GET /api/admin/payments
export class QueryAdminPaymentDto {
  @IsOptional()
  @IsIn(['cod', 'payos'])
  method?: 'cod' | 'payos';

  @IsOptional()
  @IsIn(['pending', 'success', 'failed', 'refunded'])
  status?: 'pending' | 'success' | 'failed' | 'refunded';

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

// POST /api/admin/payments/:id/confirm-cod
export class ConfirmCodPaymentDto {}
