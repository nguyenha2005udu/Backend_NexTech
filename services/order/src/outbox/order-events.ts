import { OutboxWriter } from '@nextech/service-kit';
import type { EntityManager } from 'typeorm';
import type { Order } from '../database/entities/order.entity';

// Sự kiện order.* (NT.MESSAGING API_Spec §3). Luôn gọi trong transaction đang đổi trạng thái đơn, bằng
// đúng EntityManager của transaction đó: đơn và sự kiện cùng commit hoặc cùng mất.
const writer = new OutboxWriter('order');

type OrderRef = Pick<Order, 'id' | 'user_id'>;
type OrderWithTotal = OrderRef & Pick<Order, 'total'>;

export const orderEvents = {
  created: (m: EntityManager, o: OrderWithTotal) =>
    writer.enqueue(m, 'order.created', {
      order_id: o.id,
      user_id: o.user_id,
      total: Number(o.total),
    }),

  paid: (m: EntityManager, o: OrderWithTotal) =>
    writer.enqueue(m, 'order.paid', {
      order_id: o.id,
      user_id: o.user_id,
      total: Number(o.total),
    }),

  /** `by`: `user`, `admin`, hoặc `system` (hết hạn giữ hàng) */
  cancelled: (m: EntityManager, o: OrderRef, by: string) =>
    writer.enqueue(m, 'order.cancelled', {
      order_id: o.id,
      user_id: o.user_id,
      cancelled_by: by,
    }),

  failed: (m: EntityManager, o: OrderRef, reason: string | null) =>
    writer.enqueue(m, 'order.failed', {
      order_id: o.id,
      user_id: o.user_id,
      reason: reason ?? 'Đặt hàng không thành công',
    }),
};
