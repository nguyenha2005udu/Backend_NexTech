// Chép findMine, findOneMine từ be/src/users/order/order.service.ts. Đổi do tách service
// (NT.ORDER Component_Class_Design §2): đọc product_name, product_image từ snapshot order_items,
// bỏ imageRepo, relations product → không gọi catalog, catalog chết vẫn xem được (Processing_Flow §3).
// Thêm: ẩn `failed` khi không lọc (API_Spec route 6), `failure` khi failed (NT.CHECKOUT_SAGA),
// `payment_expires_at` khi pending (NT.ORDER_HOLD §1). checkout, cancel ở modules/checkout (T3.3–T3.5).
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';
import { Order } from '../../database/entities/order.entity';
import { OrderItem } from '../../database/entities/order-item.entity';
import { orderNotFound } from '../../errors';
import { QueryOrderDto } from './order.dto';

@Injectable()
export class OrderService {
  constructor(
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
    @InjectRepository(OrderItem)
    private readonly orderItemRepo: Repository<OrderItem>,
  ) {}

  // GET /api/orders — 3 truy vấn cố định: count + đơn + dòng đơn
  async findMine(userId: string, query: QueryOrderDto) {
    const { status, page = 1, limit = 20 } = query;

    const [items, total] = await this.orderRepo.findAndCount({
      where: {
        user_id: userId,
        // Đơn saga thất bại chỉ hiện khi lọc đúng trạng thái đó
        status: status ?? Not('failed'),
      },
      // Khoá phụ id cho thứ tự ổn định khi trùng created_at (non-functional §1)
      order: { created_at: 'DESC', id: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    // Thẻ đơn trên app hiện "Đơn hàng: <tên sản phẩm đầu>" kèm ảnh như bản web
    const orderIds = items.map((o) => o.id);
    const orderItems = orderIds.length
      ? await this.orderItemRepo.find({ where: { order_id: In(orderIds) } })
      : [];
    const itemsByOrder = new Map<string, OrderItem[]>();
    for (const item of orderItems) {
      const list = itemsByOrder.get(item.order_id) ?? [];
      list.push(item);
      itemsByOrder.set(item.order_id, list);
    }

    return {
      items: items.map((o) => {
        const lines = itemsByOrder.get(o.id) ?? [];
        const first = lines[0];
        return {
          id: o.id,
          total: o.total,
          status: o.status,
          created_at: o.created_at,
          item_count: lines.length,
          product_name: first?.product_name ?? null,
          product_image: first?.product_image ?? null,
        };
      }),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // GET /api/orders/:id
  async findOneMine(userId: string, id: string) {
    const order = await this.orderRepo.findOne({
      where: { id, user_id: userId },
      relations: { items: true },
    });
    if (!order) throw orderNotFound();

    return {
      id: order.id,
      items: order.items.map((item) => ({
        product: {
          id: item.product_id,
          name: item.product_name,
          // Giá lúc mua (snapshot)
          price: item.unit_price,
          image: item.product_image,
        },
        quantity: item.quantity,
      })),
      subtotal: order.subtotal,
      shipping_fee: order.shipping_fee,
      discount_amount: order.discount_amount,
      shipping_discount_amount: order.shipping_discount_amount,
      total: order.total,
      status: order.status,
      note: order.note,
      shipping_address: {
        full_address: order.shipping_full_address,
        recipient_name: order.shipping_recipient_name,
        phone_number: order.shipping_phone_number,
      },
      created_at: order.created_at,
      ...(order.status === 'failed'
        ? {
            failure: {
              code: order.failure_code,
              message: order.failure_message,
            },
          }
        : {}),
      payment_expires_at: paymentExpiresAt(order),
    };
  }
}

/** Hạn giữ hàng chỉ có nghĩa khi đơn `pending`; COD đã đặt cột NULL (NT.ORDER_HOLD §1) */
export function paymentExpiresAt(order: Order): Date | null {
  return order.status === 'pending' ? order.payment_expires_at : null;
}
