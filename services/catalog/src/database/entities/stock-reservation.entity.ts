import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryColumn,
} from 'typeorm';
import { StockReservationItem } from './stock-reservation-item.entity';

export type StockReservationStatus = 'reserved' | 'released';

// Phiếu giữ kho của một đơn (NT.CATALOG API_Spec §6). Bảng mới, không có trong be/.
// Khoá chính là order_id: một đơn tối đa một phiếu — chỗ dựa của idempotency và tombstone.
@Entity('stock_reservations')
export class StockReservation {
  @PrimaryColumn({ type: 'uuid' })
  order_id: string;

  @Column({ type: 'varchar', length: 20 })
  status: StockReservationStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  released_at: Date | null;

  @OneToMany(() => StockReservationItem, (item) => item.reservation)
  items: StockReservationItem[];
}
