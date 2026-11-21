import { IsIn, IsUUID } from 'class-validator';

// Chép nguyên be/src/users/payment/payment.dto.ts
// ---------- POST /api/payments ----------
export class CreatePaymentDto {
  @IsUUID()
  order_id: string;

  @IsIn(['cod', 'payos'])
  method: 'cod' | 'payos';
}
