import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order } from '../database/entities/order.entity';
import { OrderItem } from '../database/entities/order-item.entity';

// "Người này đã mua sản phẩm này chưa" cho catalog (BR-11) — NT.ORDER API_Spec §2.
// Thay cho JOIN order_items ↔ orders mà be/ làm thẳng trong users/product/product.service.ts createReview.
// Đã mua = có dòng đơn thuộc đơn paid hoặc shipped (đơn pending chưa tính).
const PURCHASED_STATUSES = ['paid', 'shipped'];

@Injectable()
export class PurchasesInternalService {
  constructor(
    @InjectRepository(OrderItem)
    private readonly orderItemRepo: Repository<OrderItem>,
  ) {}

  // 1 truy vấn SELECT EXISTS, đi ix_order_items_product
  async hasPurchased(
    userId: string,
    productId: string,
  ): Promise<{ purchased: boolean }> {
    const purchased = await this.orderItemRepo
      .createQueryBuilder('item')
      .innerJoin(Order, 'o', 'o.id = item.order_id')
      .where('item.product_id = :productId', { productId })
      .andWhere('o.user_id = :userId', { userId })
      .andWhere('o.status IN (:...statuses)', { statuses: PURCHASED_STATUSES })
      .getExists();
    return { purchased };
  }
}
