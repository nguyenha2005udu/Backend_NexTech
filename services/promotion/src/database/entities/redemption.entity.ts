import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

export type RedemptionStatus = 'redeemed' | 'released';

// Lượt dùng mã của một đơn (NT.PROMOTION API_Spec §5). Bảng mới, không có trong be/.
// Khoá chính là order_id: một đơn tối đa một dòng — chỗ dựa của idempotency và tombstone.
// discount_code_id, freeship_code_id không đặt khoá ngoại: tombstone có thể tạo trước khi biết mã.
@Entity('redemptions')
export class Redemption {
  @PrimaryColumn({ type: 'uuid' })
  order_id: string;

  @Column({ type: 'varchar', length: 20 })
  status: RedemptionStatus;

  @Column({ type: 'uuid', nullable: true })
  discount_code_id: string | null;

  @Column({ type: 'uuid', nullable: true })
  freeship_code_id: string | null;

  @Column({ type: 'bigint', default: 0 })
  discount_amount: number;

  @Column({ type: 'bigint', default: 0 })
  shipping_discount_amount: number;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  released_at: Date | null;
}
