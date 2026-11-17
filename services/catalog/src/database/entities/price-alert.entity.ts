// Chép từ be/src/database/price-alert.entity.ts. Đổi do tách service (API_Spec §6, Component_Class_Design §4):
// - Bỏ @ManyToOne User (identity-service). Giữ cột user_id uuid, không khoá ngoại. Giữ @ManyToOne Product.
// - Unique một alert `active` cho mỗi (user, product): BR-12 bảo đảm ở DB (quyết định B1). Partial index,
//   TypeORM sinh được nhờ `where`.
// - Index product_id: cron theo dõi giá join theo sản phẩm (T2.5).
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Product } from './product.entity';

export type PriceAlertStatus = 'active' | 'triggered' | 'cancelled';
export type NotifyChannel = 'app' | 'email' | 'sms';

@Entity('price_alerts')
@Index('ux_alerts_user_product_active', ['user_id', 'product_id'], {
  unique: true,
  where: `"status" = 'active'`,
})
export class PriceAlert {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  user_id: string;

  @Index('IDX_price_alerts_product_id')
  @Column({ type: 'uuid' })
  product_id: string;

  @ManyToOne(() => Product, (product) => product.price_alerts, {
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  })
  @JoinColumn({ name: 'product_id' })
  product: Product;

  // Ngưỡng giá mong muốn
  @Column({ type: 'bigint' })
  target_price: number;

  // active / triggered / cancelled
  @Column({ type: 'varchar', length: 20, default: 'active' })
  status: PriceAlertStatus;

  // app / email / sms
  @Column({ type: 'varchar', length: 30, default: 'app' })
  notify_channel: NotifyChannel;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @Column({ type: 'timestamp', nullable: true })
  triggered_at: Date | null;
}
