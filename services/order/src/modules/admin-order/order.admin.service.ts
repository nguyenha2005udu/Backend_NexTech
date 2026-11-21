// Chép từ be/src/admin/order/order.admin.service.ts. Đổi do tách service (NT.ORDER Component_Class_Design §2):
// - Bỏ JOIN users: tên, email, SĐT lấy từ snapshot orders.customer_* (identity_db ở service khác).
// - Dòng đơn đọc snapshot product_name, unit_price; giữ quan hệ payment (cùng service).
// - updateStatus viết lại theo API_Spec §1 route 11 + business-spec §5 (sổ A1: không đặt `paid` tay,
//   pending → shipped chỉ đơn COD). Giao COD xác nhận giao dịch cùng transaction (T3.6, confirmCodByOrder).
// - Huỷ: OrderCancelService của NT.CHECKOUT_SAGA (T3.5) thay releaseOrderResources; chỉ đọc payments khi
//   giao hàng (NT.ORDER v1.6).
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Order, OrderStatus } from '../../database/entities/order.entity';
import { OrderItem } from '../../database/entities/order-item.entity';
import { Payment } from '../../database/entities/payment.entity';
import { invalidTransition, orderNotFound } from '../../errors';
import { OrderCancelService } from '../checkout/order-cancel.service';
import { PaymentCoreService } from '../payment/payment-core.service';
import { paymentExpiresAt } from '../order/order.service';
import { QueryAdminOrderDto, UpdateOrderStatusDto } from './order.admin.dto';

// BR-06, business-spec §5. Admin chỉ đặt shipped, cancelled (DTO chặn giá trị khác).
// processing, failed, shipped, cancelled là trạng thái admin không đổi được.
const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  processing: [],
  pending: ['shipped', 'cancelled'],
  paid: ['shipped', 'cancelled'],
  shipped: [],
  cancelled: [],
  failed: [],
};

@Injectable()
export class AdminOrderService {
  constructor(
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
    private readonly dataSource: DataSource,
    private readonly orderCancel: OrderCancelService,
    private readonly paymentCore: PaymentCoreService,
  ) {}

  // GET /api/admin/orders — 2 truy vấn: count + data (product_count là subquery, không nhân dòng)
  async findAll(query: QueryAdminOrderDto) {
    const { search, status, from, to, page = 1, limit = 20 } = query;

    const qb = this.orderRepo.createQueryBuilder('order');

    if (search) {
      // be/ tìm theo users.full_name; nay theo snapshot tên người mua
      qb.andWhere('order.customer_name ILIKE :search', {
        search: `%${search}%`,
      });
    }
    if (status) {
      qb.andWhere('order.status = :status', { status });
    }
    if (from) {
      qb.andWhere('order.created_at >= :from', { from: new Date(from) });
    }
    if (to) {
      qb.andWhere('order.created_at <= :to', { to: new Date(to) });
    }

    // Tổng số lượng sản phẩm trong đơn — dùng subquery thay vì leftJoin
    // để không làm nhân bản dòng (ảnh hưởng skip/take và tổng total)
    qb.addSelect((subQuery) => {
      return subQuery
        .select('COALESCE(SUM(item.quantity), 0)', 'sum')
        .from(OrderItem, 'item')
        .where('item.order_id = order.id');
    }, 'product_count');

    const total = await qb.getCount();

    // Khoá phụ id cho thứ tự ổn định (non-functional §1)
    qb.orderBy('order.created_at', 'DESC')
      .addOrderBy('order.id', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const { raw, entities } = await qb.getRawAndEntities<{
      product_count: string;
    }>();

    return {
      items: entities.map((o, index) => ({
        id: o.id,
        user_name: o.customer_name ?? null,
        product_count: Number(raw[index]?.product_count ?? 0),
        total: o.total,
        status: o.status,
        created_at: o.created_at,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // GET /api/admin/orders/:id
  async findOne(id: string) {
    const order = await this.orderRepo.findOne({
      where: { id },
      relations: { items: true, payment: true },
    });
    if (!order) throw orderNotFound();

    return {
      id: order.id,
      user: {
        id: order.user_id,
        full_name: order.customer_name,
        email: order.customer_email,
        phone_number: order.customer_phone,
      },
      items: order.items.map((item) => ({
        product: {
          id: item.product_id,
          name: item.product_name,
          // Giá lúc mua (snapshot)
          price: item.unit_price,
        },
        quantity: item.quantity,
      })),
      subtotal: order.subtotal,
      shipping_fee: order.shipping_fee,
      discount_amount: order.discount_amount,
      total: order.total,
      status: order.status,
      note: order.note,
      payment: order.payment ?? null,
      payment_expires_at: paymentExpiresAt(order),
      created_at: order.created_at,
    };
  }

  // PUT /api/admin/orders/:id/status (API_Spec §1 route 11).
  // Khoá dòng Postgres như be/; khoá Redis withOrderLock (BR-20) bọc thêm ở T3.9.
  async updateStatus(id: string, dto: UpdateOrderStatusDto) {
    const r = await this.dataSource.transaction(async (manager) => {
      const orderRepo = manager.getRepository(Order);

      // Khoá dòng đơn để không đua với người mua tự huỷ / webhook thanh toán.
      // Tách query payment vì Postgres không cho FOR UPDATE kèm LEFT JOIN.
      const order = await orderRepo.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!order) throw orderNotFound();

      if (!ALLOWED_TRANSITIONS[order.status].includes(dto.status)) {
        throw invalidTransition(order.status, dto.status);
      }

      // Huỷ chỉ có một chỗ (NT.ORDER Processing_Flow §4): saga_tasks, voidPendingByOrder,
      // (T4.1) outbox cancelled_by admin. paid → cancelled: giao dịch success giữ nguyên, hoàn tiền tay (be/).
      if (dto.status === 'cancelled') {
        return this.orderCancel.cancel(manager, order, 'admin');
      }

      // Chỉ đọc giao dịch khi giao hàng (NT.ORDER v1.6): be/ đọc mọi lần, huỷ không dùng tới
      const payment = await manager
        .getRepository(Payment)
        .findOne({ where: { order_id: id } });

      // pending → shipped chỉ đơn COD còn chờ thu tiền; đơn PayOS phải paid trước
      const isCodDelivery = order.status === 'pending';
      if (
        isCodDelivery &&
        !(payment?.method === 'cod' && payment.status === 'pending')
      ) {
        throw invalidTransition(order.status, dto.status);
      }
      // Giao COD = thu tiền: giao dịch success cùng transaction với đơn shipped (be/ confirmCodForOrder). Không phát
      // order.paid vì đơn sang shipped (NT.MESSAGING API_Spec §3)
      if (isCodDelivery) {
        await this.paymentCore.confirmCodByOrder(manager, id);
      }

      order.status = dto.status;
      const saved = await orderRepo.save(order);

      return {
        result: {
          id: saved.id,
          status: saved.status,
          updated_at: saved.updated_at,
        },
        tasks: null,
      };
    });

    // Sau commit, giống người mua huỷ: nhả trong ngân sách, lỗi thì cron. T3.10: unschedule hạn giữ hàng.
    if (r.tasks) await this.orderCancel.releaseAfterCommit(id, r.tasks);
    return r.result;
  }
}
