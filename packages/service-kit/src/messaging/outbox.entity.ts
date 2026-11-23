import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

// Bảng outbox (NT.MESSAGING API_Spec §4). Service phát sự kiện thêm entity này vào danh sách entity
// của mình và tự viết migration tạo bảng.
@Entity('outbox')
@Index('ix_outbox_unpublished', ['created_at'], {
  where: 'published_at IS NULL',
})
export class OutboxEvent {
  /** Chính là event_id */
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 100 })
  routing_key!: string;

  /** Toàn bộ thông điệp (EventEnvelope) */
  @Column({ type: 'jsonb' })
  payload!: object;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  published_at!: Date | null;

  @Column({ type: 'int', default: 0 })
  attempts!: number;
}
