// Chép nguyên từ be/src/database/user-profile.entity.ts
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

@Entity('user_profiles')
export class UserProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', unique: true })
  user_id: string;

  @OneToOne(() => User, (user) => user.profile, {
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  })
  @JoinColumn({ name: 'user_id' })
  user: User;

  // sinh viên / người đi làm / phụ huynh...
  @Column({ type: 'varchar', length: 50, nullable: true })
  user_segment: string | null;

  // Nghề nghiệp / ngành học
  @Column({ type: 'varchar', length: 100, nullable: true })
  occupation: string | null;

  // VD: 18-22, 23-30
  @Column({ type: 'varchar', length: 20, nullable: true })
  age_range: string | null;

  // Mảng sở thích
  @Column({ type: 'json', nullable: true })
  interests: string[] | null;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updated_at: Date;
}
