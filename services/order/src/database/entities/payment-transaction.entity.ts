import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Payment } from './payment.entity';

// NT.PAYMENT API_Spec §3.1
export type LedgerOutcome =
  | 'received'
  | 'applied'
  | 'duplicate_payment'
  | 'order_not_payable'
  | 'amount_mismatch'
  | 'invalid_payment_state'
  | 'unmatched';

// Sổ tiền về (NT.PAYMENT v2.5, ADR-0016). Mới, không có trong be/: mỗi lần PayOS báo tiền về qua webhook là một
// dòng, chỉ ghi thêm. DDL ở NT.PAYMENT API_Spec §6. counter_account_*, raw_payload: không log, chỉ route admin
// đọc, raw_payload không trả qua API (security-policy §5).
@Entity('payment_transactions')
@Index('ix_payment_transactions_payment', ['payment_id', 'received_at'], {
  where: '"payment_id" IS NOT NULL',
})
// Đối soát: dòng chưa áp được hoặc cần hoàn tiền
@Index('ix_payment_transactions_review', ['received_at'], {
  where: `"outcome" <> 'applied'`,
})
export class PaymentTransaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 20, default: 'payos' })
  provider: string;

  // data.reference, hoặc 'sig:' + signature khi thiếu reference
  @Column({ type: 'varchar', length: 255, unique: true })
  dedup_key: string;

  // Mã giao dịch phía ngân hàng
  @Column({ type: 'varchar', length: 100, nullable: true })
  reference: string | null;

  // NULL khi unmatched / chưa chốt. Cùng service nên có FK
  @Column({ type: 'uuid', nullable: true })
  payment_id: string | null;

  @ManyToOne(() => Payment, { nullable: true })
  @JoinColumn({ name: 'payment_id' })
  payment: Payment | null;

  // data.orderCode (cùng kiểu với payments.transaction_id)
  @Column({ type: 'varchar', length: 255 })
  order_code: string;

  @Column({ type: 'bigint' })
  amount: string;

  @Column({ type: 'varchar', length: 10, default: 'VND' })
  currency: string;

  // Tài khoản nhận (của shop)
  @Column({ type: 'varchar', length: 50, nullable: true })
  account_number: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  counter_account_bank_id: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  counter_account_bank_name: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  counter_account_name: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  counter_account_number: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description: string | null;

  // Chuỗi gốc của PayOS ("2023-02-04 18:25:00"), không kèm múi giờ, không chuyển đổi (v2.6)
  @Column({ type: 'varchar', length: 30, nullable: true })
  transaction_date_time: string | null;

  @Column({ type: 'varchar', length: 30, default: 'received' })
  outcome: LedgerOutcome;

  // data đã kiểm chữ ký
  @Column({ type: 'jsonb' })
  raw_payload: Record<string, unknown>;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  received_at: Date;

  // Lúc chốt outcome
  @Column({ type: 'timestamptz', nullable: true })
  processed_at: Date | null;
}
