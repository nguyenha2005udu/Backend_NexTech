import { IsUUID } from 'class-validator';

// Query GET /internal/purchases/check (NT.ORDER API_Spec §2). Sai định dạng → 400 NT-GEN-0001.
export class PurchaseCheckQueryDto {
  @IsUUID('all')
  user_id: string;

  @IsUUID('all')
  product_id: string;
}
