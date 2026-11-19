import {
  Check,
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { StockReservation } from './stock-reservation.entity';

// Một dòng của phiếu giữ kho: sản phẩm nào, trừ bao nhiêu — để nhả lại đúng số lượng (API_Spec §6).
// product_id không đặt khoá ngoại: sản phẩm có thể bị xoá sau khi giữ, nhả kho khi đó bỏ qua dòng này.
@Entity('stock_reservation_items')
@Check('CHK_stock_reservation_items_quantity', '"quantity" > 0')
export class StockReservationItem {
  @PrimaryColumn({ type: 'uuid' })
  order_id: string;

  @PrimaryColumn({ type: 'uuid' })
  product_id: string;

  @Column({ type: 'int' })
  quantity: number;

  @ManyToOne(() => StockReservation, (r) => r.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  reservation: StockReservation;
}
