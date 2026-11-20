// Các bước tiến của saga đặt hàng (NT.CHECKOUT_SAGA Component_Class_Design §4–5, ADR-0005).
// Thay đoạn giữa của be/src/users/order/order.service.ts checkout: reserveStock (dòng 127–131),
// consumeDiscount (dòng 248–249), xoá dòng giỏ (dòng 252) — nay là lời gọi catalog, promotion và một
// transaction xác nhận. Không giữ transaction nào trong lúc gọi HTTP.
// T3.3: luồng thành công. Lỗi từ service đích ném lại (handleError, hoàn tác ở T3.4); outbox
// order.created ở T4.1; payment_expires_at ở T3.10.
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Not, Repository } from 'typeorm';
import { CatalogClient } from '../../clients/catalog.client';
import {
  PromotionClient,
  type RedeemRequest,
} from '../../clients/promotion.client';
import { CartItem } from '../../database/entities/cart-item.entity';
import { Order } from '../../database/entities/order.entity';
import { totalOf } from './order-pricing';
import {
  isBudgetExhausted,
  SagaPreempted,
  type SagaOutcome,
  type SagaStep,
  toOutcome,
} from './saga.types';

// Cột ghi kèm khi đổi bước (setStep promotion_redeemed)
type StepAmounts = Partial<
  Pick<
    Order,
    | 'discount_code_id'
    | 'freeship_code_id'
    | 'discount_amount'
    | 'shipping_discount_amount'
    | 'total'
  >
>;

@Injectable()
export class CheckoutSagaService {
  constructor(
    @InjectRepository(Order)
    private readonly orders: Repository<Order>,
    private readonly dataSource: DataSource,
    private readonly catalog: CatalogClient,
    private readonly promotion: PromotionClient,
  ) {}

  /**
   * Đọc saga_step và làm tiếp, chạy lại bao nhiêu lần cũng an toàn (dùng chung cho request và cron).
   * `order` phải kèm `items` (checkout vừa tạo đơn truyền thẳng, khỏi đọc lại).
   * `deadline` (epoch ms): ngân sách của request; cron không truyền.
   */
  async advance(order: Order, deadline?: number): Promise<SagaOutcome> {
    if (order.status !== 'processing' || order.saga_step === 'compensating') {
      return toOutcome(order); // đã có kết quả, hoặc đang hoàn tác
    }
    try {
      if (order.saga_step === 'started') {
        if (isBudgetExhausted(deadline)) return { kind: 'in_doubt', order };
        await this.catalog.reserve(
          order.id,
          order.items.map((i) => ({
            product_id: i.product_id,
            quantity: i.quantity,
          })),
          { deadline },
        );
        order = await this.setStep(order, 'stock_reserved');
      }
      if (
        order.saga_step === 'stock_reserved' &&
        (order.discount_code || order.freeship_code)
      ) {
        if (isBudgetExhausted(deadline)) return { kind: 'in_doubt', order };
        order = await this.redeemPromotion(order, deadline);
      }
      // Không có mã: giữ nguyên stock_reserved và đi thẳng tới xác nhận
      return { kind: 'confirmed', order: await this.confirm(order) };
    } catch (err) {
      if (err instanceof SagaPreempted) {
        // Bên khác đã đổi đơn: không hoàn tác, không xác nhận
        return toOutcome(await this.orders.findOneByOrFail({ id: order.id }));
      }
      throw err; // T3.4 thay bằng handleError (hoàn tác hoặc in_doubt theo outcome)
    }
  }

  // Số tiền giảm do promotion tính (BR-05, discount-calculator); order chỉ cộng trừ ra total
  private async redeemPromotion(
    order: Order,
    deadline?: number,
  ): Promise<Order> {
    const subtotal = Number(order.subtotal);
    const shippingFee = Number(order.shipping_fee);
    const dto: RedeemRequest = {
      order_id: order.id,
      subtotal,
      shipping_fee: shippingFee,
    };
    if (order.discount_code) dto.discount_code = order.discount_code;
    if (order.freeship_code) dto.freeship_code = order.freeship_code;

    const r = await this.promotion.redeem(dto, { deadline });
    return this.setStep(order, 'promotion_redeemed', {
      discount_code_id: r.discount_code_id,
      freeship_code_id: r.freeship_code_id,
      discount_amount: String(r.discount_amount),
      shipping_discount_amount: String(r.shipping_discount_amount),
      total: String(
        totalOf(
          subtotal,
          shippingFee,
          r.discount_amount,
          r.shipping_discount_amount,
        ),
      ),
    });
  }

  // UPDATE có điều kiện đúng bước đang mong đợi: request và cron cùng chạy thì chỉ một bên ghi.
  // updated_at do @UpdateDateColumn tự đặt (cron dựa vào nó để tìm đơn kẹt).
  private async setStep(
    order: Order,
    next: SagaStep,
    extra: StepAmounts = {},
  ): Promise<Order> {
    const r = await this.orders.update(
      { id: order.id, status: 'processing', saga_step: order.saga_step },
      { saga_step: next, ...extra },
    );
    if (!r.affected) throw new SagaPreempted();
    return { ...order, saga_step: next, ...extra };
  }

  // Một transaction: processing → pending, xoá đúng các dòng giỏ đã lên đơn (dòng không chọn còn lại,
  // như be/). Đơn đang hoàn tác không được xác nhận. Bên thua đọc lại đơn, không xoá giỏ lần nữa.
  private confirm(order: Order): Promise<Order> {
    return this.dataSource.transaction(async (m) => {
      const r = await m.update(
        Order,
        { id: order.id, status: 'processing', saga_step: Not('compensating') },
        { status: 'pending', saga_step: 'confirmed' },
      );
      if (!r.affected) return m.findOneByOrFail(Order, { id: order.id });

      const selected = order.selected_cart_item_ids ?? [];
      if (selected.length) await m.delete(CartItem, { id: In(selected) });
      // outbox order.created: T4.1 (NT.MESSAGING)
      return { ...order, status: 'pending', saga_step: 'confirmed' };
    });
  }
}
