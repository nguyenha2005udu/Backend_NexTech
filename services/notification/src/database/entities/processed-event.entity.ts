import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

// Chống xử lý trùng sự kiện (NT.NOTIFICATION API_Spec §6, NT.MESSAGING Processing_Flow §2):
// INSERT ... ON CONFLICT DO NOTHING cùng transaction với thông báo.
@Entity('processed_events')
export class ProcessedEvent {
  @PrimaryColumn('uuid')
  event_id: string;

  @Column({ type: 'varchar', length: 100 })
  event_type: string;

  @CreateDateColumn({ type: 'timestamptz' })
  processed_at: Date;
}
