import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

// Chép từ be/src/database/discount-code.entity.ts. Bỏ `@OneToMany Order`: đơn hàng thuộc order-service,
// liên kết qua bảng `redemptions` (NT.PROMOTION Component_Class_Design §2).

export type VoucherCategory = 'order' | 'free_shipping';
export type DiscountType = 'percent' | 'fixed_amount';

@Entity('discount_codes')
export class DiscountCode {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 50, unique: true })
  code: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description: string | null;

  @Column({ type: 'varchar', length: 20, default: 'order' })
  category: VoucherCategory;
  @Column({ type: 'varchar', length: 20, default: 'percent' })
  discount_type: DiscountType;

  @Column({ type: 'bigint' })
  discount_value: number;

  @Column({ type: 'bigint', nullable: true })
  min_order_value: number | null;

  @Column({ type: 'bigint', nullable: true })
  max_discount: number | null;

  @Column({ type: 'int', nullable: true })
  usage_limit: number | null;

  @Column({ type: 'int', default: 0 })
  used_count: number;

  @Column({ type: 'timestamp', nullable: true })
  valid_from: Date;

  @Column({ type: 'timestamp', nullable: true })
  valid_until: Date | null;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  // Cả 3 API danh sách sắp theo created_at DESC (non-functional-standards §1: index cột sắp xếp)
  @Index('IDX_discount_codes_created_at')
  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;
}
