// Chép nguyên be/src/users/pricealert/pricealert.dto.ts.
import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsUUID, Min } from 'class-validator';

// POST /api/price-alerts
export class CreatePriceAlertDto {
  @IsUUID()
  product_id: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  target_price: number;

  @IsOptional()
  @IsIn(['app', 'email', 'sms'])
  notify_channel?: 'app' | 'email' | 'sms' = 'app';
}
