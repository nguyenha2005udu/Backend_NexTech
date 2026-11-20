import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Cart } from './cart.entity';

// Từ be/src/database/cart-item.entity.ts. Bỏ @ManyToOne Product: sản phẩm ở catalog, chỉ giữ id.
// cart_id + product_id là duy nhất: 1 sản phẩm chỉ xuất hiện 1 lần trong 1 giỏ hàng
@Entity('cart_items')
@Unique(['cart_id', 'product_id'])
export class CartItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  cart_id: string;

  @ManyToOne(() => Cart, (cart) => cart.items, {
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  })
  @JoinColumn({ name: 'cart_id' })
  cart: Cart;

  // Không FK: sản phẩm thuộc catalog_db
  @Column({ type: 'uuid' })
  product_id: string;

  @Column({ type: 'int', default: 1 })
  quantity: number;

  @CreateDateColumn({ type: 'timestamp' })
  added_at: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updated_at: Date;
}
