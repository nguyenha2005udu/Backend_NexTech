import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

// Chép từ database/notification.entity.ts của source cũ. Bỏ @ManyToOne User (users ở identity-service):
// giữ cột user_id uuid, không khoá ngoại (NT.NOTIFICATION Component_Class_Design §2, API_Spec §6).

// price_alert / deal / recommendation / order_update / system
export type NotificationType =
  'price_alert' | 'deal' | 'recommendation' | 'order_update' | 'system';
// app / email / sms / push
export type NotificationChannel = 'app' | 'email' | 'sms' | 'push';

@Entity('notifications')
// (user_id, created_at DESC): TypeORM không khai được DESC → index viết tay trong migration Init
@Index('ix_notifications_user', { synchronize: false })
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  user_id: string;

  @Column({ type: 'varchar', length: 30 })
  type: NotificationType;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'text', nullable: true })
  body: string | null;

  // Dữ liệu bổ sung: product_id, order_id, url...
  @Column({ type: 'json', nullable: true })
  data: object | null;

  @Column({ type: 'boolean', default: false })
  is_read: boolean;

  @Column({ type: 'varchar', length: 20, default: 'app' })
  channel: NotificationChannel;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;
}
