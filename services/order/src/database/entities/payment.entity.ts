import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Order } from './order.entity';

// cod / payos
export type PaymentMethod = 'cod' | 'payos';
// pending / success / failed / refunded
export type PaymentStatus = 'pending' | 'success' | 'failed' | 'refunded';

// Từ be/src/database/payment.entity.ts. Cùng service với orders nên giữ FK (ADR-0014).
// Thêm previous_transaction_ids, needs_refund theo NT.PAYMENT API_Spec §6.
// 1 đơn hàng có 1 thanh toán
@Entity('payments')
@Index('ix_payments_paid_at', ['paid_at'], { where: `"status" = 'success'` })
// GIN trên mảng: TypeORM không khai được → viết tay trong migration Init
@Index('ix_payments_prev_codes', { synchronize: false })
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // UNIQUE do @OneToOne bên dưới tạo (một đơn tối đa một giao dịch)
  @Column({ type: 'uuid' })
  order_id: string;

  @OneToOne(() => Order, (order) => order.payment)
  @JoinColumn({ name: 'order_id' })
  order: Order;

  @Column({ type: 'varchar', length: 30 })
  method: PaymentMethod;

  // orderCode hiện hành, lưu trước khi gọi PayOS
  @Column({ type: 'varchar', length: 255, unique: true, nullable: true })
  transaction_id: string | null;

  // Mã của các lần tạo link trước, để webhook tra mã cũ
  @Column({ type: 'text', array: true, default: () => "'{}'" })
  previous_transaction_ids: string[];

  // Số tiền thanh toán (VNĐ)
  @Column({ type: 'bigint' })
  amount: string;

  @Column({ type: 'varchar', length: 10, default: 'VND' })
  currency: string;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status: PaymentStatus;

  // Raw response từ cổng thanh toán (dùng để đối soát/debug)
  @Column({ type: 'json', nullable: true })
  gateway_response: Record<string, unknown> | null;

  // Số tiền đã hoàn (nếu có)
  @Column({ type: 'bigint', nullable: true })
  refunded_amount: string | null;

  // Thời điểm thanh toán thành công
  @Column({ type: 'timestamp', nullable: true })
  paid_at: Date | null;

  // BR-10
  @Column({ type: 'boolean', default: false })
  needs_refund: boolean;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updated_at: Date;
}
