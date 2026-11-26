// Chép từ source cũ database/conversation.entity.ts (design/ASSISTANT/README.md §5).
// Bỏ @ManyToOne User (users ở identity, chỉ giữ cột uuid), @OneToMany Event (bảng events ngoài phạm vi).
import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Message } from './message.entity';

export type ConversationChannel = 'chat' | 'voice';
export type ConversationStep = 'search' | 'compare' | 'recommend' | 'done';

@Entity('conversations')
export class Conversation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // NULL = phiên của khách. Không FK (users ở identity-service)
  @Column({ type: 'uuid', nullable: true })
  user_id: string | null;

  // Định danh thiết bị của khách (cookie httpOnly `guest_id`). Gán phiên (claim) thì về NULL (BR-15)
  @Column({ type: 'uuid', nullable: true })
  guest_id: string | null;

  // Tiêu đề tự sinh từ tin nhắn đầu tiên
  @Column({ type: 'varchar', length: 255, nullable: true })
  title: string | null;

  @Column({ type: 'varchar', length: 20, default: 'chat' })
  channel: ConversationChannel;

  // AI chỉ tư vấn và gợi ý, không thêm giỏ hàng hay thanh toán thay người dùng (BR-13)
  @Column({ type: 'varchar', length: 30, default: 'search' })
  current_step: ConversationStep;

  @Column({ type: 'json', nullable: true })
  context: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamp' })
  started_at: Date;

  @Column({ type: 'timestamp', nullable: true })
  ended_at: Date | null;

  @UpdateDateColumn({ type: 'timestamp' })
  updated_at: Date;

  @OneToMany(() => Message, (message) => message.conversation)
  messages: Message[];
}
