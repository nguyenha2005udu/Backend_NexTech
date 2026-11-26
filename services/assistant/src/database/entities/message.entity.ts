// Chép từ source cũ database/message.entity.ts (design/ASSISTANT/README.md §5). Bỏ @OneToMany Event.
// created_at là @Column có default thay cho @CreateDateColumn: sendMessage gán giờ tường minh để câu hỏi
// luôn đứng trước câu trả lời khi lưu chung một transaction (NT.ASSISTANT_CONVERSATION §3).
import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Conversation } from './conversation.entity';

export type MessageSender = 'user' | 'agent';
export type MessageType = 'text' | 'product_card' | 'comparison_table';

@Entity('messages')
export class Message {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  conversation_id: string;

  @ManyToOne(() => Conversation, (conversation) => conversation.messages, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'conversation_id' })
  conversation: Conversation;

  @Column({ type: 'varchar', length: 10 })
  sender: MessageSender;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'varchar', length: 20, default: 'text' })
  message_type: MessageType;

  // product_card: { products } là sản phẩm lấy từ catalog, không lấy từ chữ AI viết (BR-13)
  @Column({ type: 'json', nullable: true })
  metadata: Record<string, unknown> | null;

  @Column({ type: 'timestamp', default: () => 'now()' })
  created_at: Date;
}
