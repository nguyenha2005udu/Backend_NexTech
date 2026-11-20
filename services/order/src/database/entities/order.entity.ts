import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { OrderItem } from './order-item.entity';
import { Payment } from './payment.entity';

// Bỏ simulated_success của be/ (domain-glossary). processing, failed là trạng thái của saga.
export type OrderStatus =
  'processing' | 'pending' | 'paid' | 'shipped' | 'cancelled' | 'failed';

// Từ be/src/database/order.entity.ts. Bỏ quan hệ tới User, Address, DiscountCode (service khác),
// giữ Payment (cùng service). Thêm snapshot người mua, mã, cột saga, hạn giữ hàng theo DDL
// NT.ORDER API_Spec §5. bigint đọc ra là string như be/ (pg không ép kiểu int8).
@Entity('orders')
@Index('ux_orders_idempotency', ['user_id', 'idempotency_key'], {
  unique: true,
  where: '"idempotency_key" IS NOT NULL',
})
// Đơn đang hoàn tác không khoá giỏ (NT.CHECKOUT_SAGA/API_Spec.md §1)
@Index('ux_orders_cart_processing', ['cart_id'], {
  unique: true,
  where: `"status" = 'processing' AND "saga_step" <> 'compensating'`,
})
// (user_id, created_at DESC): TypeORM không khai được DESC → viết tay trong migration Init
@Index('ix_orders_user_created', { synchronize: false })
@Index('ix_orders_processing', ['updated_at'], {
  where: `"status" = 'processing'`,
})
// Quét dự phòng đơn quá hạn khi Redis mất mục (NT.ORDER_HOLD)
@Index('ix_orders_hold_due', ['payment_expires_at'], {
  where: `"status" = 'pending' AND "payment_expires_at" IS NOT NULL`,
})
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  user_id: string;

  @Column({ type: 'uuid', nullable: true })
  cart_id: string | null;

  @Column({ type: 'uuid', nullable: true })
  address_id: string | null;

  // Snapshot người mua và địa chỉ
  @Column({ type: 'varchar', length: 255, nullable: true })
  customer_name: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  customer_email: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  customer_phone: string | null;

  @Column({ type: 'varchar', length: 255 })
  shipping_full_address: string;

  @Column({ type: 'varchar', length: 150, nullable: true })
  shipping_recipient_name: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  shipping_phone_number: string | null;

  // Mã giảm giá: snapshot chuỗi mã + id bên promotion, không FK
  @Column({ type: 'varchar', length: 50, nullable: true })
  discount_code: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  freeship_code: string | null;

  @Column({ type: 'uuid', nullable: true })
  discount_code_id: string | null;

  @Column({ type: 'uuid', nullable: true })
  freeship_code_id: string | null;

  @Column({ type: 'bigint' })
  subtotal: string;

  @Column({ type: 'bigint', default: 0 })
  shipping_fee: string;

  @Column({ type: 'bigint', default: 0 })
  discount_amount: string;

  @Column({ type: 'bigint', default: 0 })
  shipping_discount_amount: string;

  @Column({ type: 'bigint' })
  total: string;

  @Column({ type: 'varchar', length: 30, default: 'processing' })
  status: OrderStatus;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  // Saga (NT.CHECKOUT_SAGA)
  @Column({ type: 'varchar', length: 30, default: 'started' })
  saga_step: string;

  @Column({ type: 'timestamptz', nullable: true })
  saga_deadline: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  selected_cart_item_ids: string[] | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  failure_code: string | null;

  @Column({ type: 'text', nullable: true })
  failure_message: string | null;

  @Column({ type: 'smallint', nullable: true })
  failure_status: number | null;

  @Column({ type: 'boolean', default: false })
  notify_on_finish: boolean;

  @Column({ type: 'varchar', length: 100, nullable: true })
  idempotency_key: string | null;

  // Hạn giữ hàng BR-19 (NT.ORDER_HOLD); NULL khi chưa pending hoặc đã chọn COD
  @Column({ type: 'timestamptz', nullable: true })
  payment_expires_at: Date | null;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updated_at: Date;

  @OneToMany(() => OrderItem, (item) => item.order)
  items: OrderItem[];

  @OneToOne(() => Payment, (payment) => payment.order)
  payment: Payment;
}
