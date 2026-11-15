// Chép nguyên từ be/src/database/user-preference.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';

@Entity('user_preferences')
export class UserPreference {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', unique: true })
  user_id: string;

  // Quan hệ 1 chiều tới User, không cần sửa user.entity.ts để thêm field inverse
  @OneToOne(() => User, { onDelete: 'CASCADE', onUpdate: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  // Danh mục sản phẩm người dùng quan tâm
  @Column({ type: 'json', nullable: true })
  preferred_categories: string[] | null;

  // Khoảng ngân sách ưa thích, vd { min: 100000, max: 2000000 }
  @Column({ type: 'json', nullable: true })
  budget_range: { min: number; max: number } | null;

  // Thương hiệu ưa thích
  @Column({ type: 'json', nullable: true })
  preferred_brands: string[] | null;

  // Thuộc tính khác (màu sắc, chất liệu, kiểu dáng...), lưu tự do dạng key-value
  @Column({ type: 'json', nullable: true })
  preferred_attributes: Record<string, any> | null;

  // Do pipeline AI tự ghi lại từ hành vi / ý định mua sắm gần nhất.
  // KHÔNG cho user tự sửa qua API (không có trong UpdatePreferencesDto).
  @Column({ type: 'text', nullable: true })
  last_intent_summary: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updated_at: Date;
}
