import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { CartItem } from './cart-item.entity';

// Từ be/src/database/cart.entity.ts. Bỏ @ManyToOne User (dữ liệu identity, architecture §6).
// user_id UNIQUE: hai request đồng thời không tạo hai giỏ (NT.ORDER Component_Class_Design §4).
@Entity('carts')
export class Cart {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', unique: true })
  user_id: string;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updated_at: Date;

  @OneToMany(() => CartItem, (item) => item.cart)
  items: CartItem[];
}
