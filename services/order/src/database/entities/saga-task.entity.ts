import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Order } from './order.entity';

export type SagaTaskType = 'release_promotion' | 'release_stock';
export type SagaTaskStatus = 'pending' | 'done';

// Việc hoàn tác của saga (NT.CHECKOUT_SAGA). Mới, không có trong be/. DDL: NT.ORDER API_Spec §5.
@Entity('saga_tasks')
@Unique(['order_id', 'type'])
@Index('ix_saga_tasks_pending', ['order_id', 'seq'], {
  where: `"status" = 'pending'`,
})
export class SagaTask {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  order_id: string;

  @ManyToOne(() => Order, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order: Order;

  @Column({ type: 'varchar', length: 30 })
  type: SagaTaskType;

  // Nhỏ chạy trước
  @Column({ type: 'int' })
  seq: number;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status: SagaTaskStatus;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ type: 'text', nullable: true })
  last_error: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  done_at: Date | null;
}
