import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Order } from './order.entity';

// Từ be/src/database/order-item.entity.ts. Bỏ @ManyToOne Product; thêm snapshot tên, ảnh để xem
// đơn không cần catalog (NT.ORDER Processing_Flow §3). unit_price thành bắt buộc (không có đơn cũ).
@Entity('order_items')
export class OrderItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  order_id: string;

  @ManyToOne(() => Order, (order) => order.items, {
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  })
  @JoinColumn({ name: 'order_id' })
  order: Order;

  // Không FK: sản phẩm thuộc catalog_db. Index cho purchases/check (BR-11)
  @Index('ix_order_items_product')
  @Column({ type: 'uuid' })
  product_id: string;

  @Column({ type: 'varchar', length: 255 })
  product_name: string;

  @Column({ type: 'text', nullable: true })
  product_image: string | null;

  @Column({ type: 'int' })
  quantity: number;

  // Giá 1 sản phẩm tại thời điểm đặt hàng (VNĐ)
  @Column({ type: 'bigint' })
  unit_price: string;
}
