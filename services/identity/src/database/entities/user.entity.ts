import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  OneToMany,
  Index,
} from 'typeorm';
import { UserProfile } from './user-profile.entity';
import { UserPreference } from './user-preference.entity';
import { Address } from './address.entity';

// Chép từ be/src/database/user.entity.ts. Bỏ @OneToMany tới PriceAlert, Cart, Order, Notification,
// ProductReview: các bảng đó thuộc service khác, chỉ giữ cột user_id (NT.IDENTITY Component_Class_Design §4).

export type AuthProvider = 'local' | 'google' | 'facebook';
export type UserRole = 'user' | 'admin';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 15, unique: true, nullable: true })
  phone_number: string | null;

  @Column({ type: 'varchar', length: 255, unique: true, nullable: true })
  email: string | null;

  @Column({ type: 'varchar', length: 255 })
  full_name: string;

  // Mật khẩu hash (NULL nếu dùng OAuth)
  @Column({ type: 'varchar', length: 255, nullable: true })
  password_hash: string | null;

  // URL ảnh đại diện
  @Column({ type: 'text', nullable: true })
  avatar_url: string | null;

  // local / google / facebook
  @Column({ type: 'varchar', length: 50, default: 'local' })
  auth_provider: AuthProvider;

  // user / admin
  @Column({ type: 'varchar', length: 20, default: 'user' })
  role: UserRole;

  // Sắp xếp danh sách GET /api/admin/users (non-functional-standards §1 Index)
  @Index('IDX_users_created_at')
  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updated_at: Date;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  // Đã xác thực email/OTP hay chưa
  @Column({ type: 'boolean', default: false })
  is_verified: boolean;

  // ID từ Google/Facebook (NULL nếu đăng ký local)
  @Column({ type: 'varchar', length: 255, nullable: true })
  provider_id: string | null;

  @OneToOne(() => UserProfile, (profile) => profile.user)
  profile: UserProfile;

  @OneToOne(() => UserPreference, (pref) => pref.user)
  preference: UserPreference;

  @OneToMany(() => Address, (address) => address.user)
  addresses: Address[];
}
