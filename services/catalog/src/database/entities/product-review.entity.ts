// Chép từ be/src/database/product-review.entity.ts. Đổi do tách service (API_Spec §6, Component_Class_Design §4):
// - Bỏ @ManyToOne User (identity-service). Giữ cột user_id uuid, không khoá ngoại.
// - Thêm snapshot user_name, user_avatar_url (lấy từ identity lúc tạo đánh giá, T2.5).
// - Unique (product_id, user_id): BR-11 bảo đảm ở DB (quyết định B1). Index này cũng phục vụ lọc theo product_id.
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Product } from './product.entity';

@Entity('product_reviews')
@Index('ux_reviews_user_product', ['product_id', 'user_id'], { unique: true })
export class ProductReview {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  product_id: string;

  @ManyToOne(() => Product, (product) => product.reviews, {
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  })
  @JoinColumn({ name: 'product_id' })
  product: Product;

  @Column({ type: 'uuid', nullable: true })
  user_id: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  user_name: string | null;

  @Column({ type: 'text', nullable: true })
  user_avatar_url: string | null;

  // 1.0 - 5.0
  @Column({ type: 'decimal', precision: 2, scale: 1 })
  rating: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  title: string | null;

  @Column({ type: 'text', nullable: true })
  content: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updated_at: Date;
}
