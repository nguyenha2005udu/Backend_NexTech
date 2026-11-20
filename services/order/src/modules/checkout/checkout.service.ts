// POST /api/orders (NT.CHECKOUT_SAGA API_Spec §1, Component_Class_Design §3). Chép từ
// be/src/users/order/order.service.ts checkout (dòng 84–273). Đổi do tách service (source-of-truth §2):
// - Địa chỉ, người mua: IdentityClient thay addressRepo (snapshot vào đơn); giá, tên, ảnh: CatalogClient
//   thay quan hệ product. Thứ tự kiểm giỏ trước địa chỉ (v1.5, sổ A9).
// - Một transaction lớn → saga: lưu đơn processing trước, giữ kho, dùng mã, xác nhận
//   (CheckoutSagaService). Tính giảm giá nay ở promotion.
// - Idempotency-Key, 202 khi chưa rõ kết quả, 409 khi đơn khác cùng giỏ đang chạy: mới do saga.
// - Thông báo "Đặt hàng thành công" trong transaction của be/ → sự kiện order.created qua outbox (T4.1).
import { HttpException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import {
  BusinessException,
  GEN_ERROR,
  UpstreamBusinessError,
} from '@nextech/service-kit';
import { DataSource, Repository } from 'typeorm';
import {
  CatalogClient,
  type CatalogProduct,
} from '../../clients/catalog.client';
import {
  IdentityClient,
  type IdentityAddress,
  type IdentityUser,
} from '../../clients/identity.client';
import type { CheckoutConfig } from '../../config/configuration';
import { Cart } from '../../database/entities/cart.entity';
import { CartItem } from '../../database/entities/cart-item.entity';
import { Order } from '../../database/entities/order.entity';
import { OrderItem } from '../../database/entities/order-item.entity';
import { isUniqueViolation } from '../../database/unique-violation';
import {
  cartEmpty,
  cartItemGone,
  invalidAddress,
  orderInProgress,
  productUnavailable,
} from '../../errors';
import { CheckoutSagaService } from './checkout-saga.service';
import { CreateOrderDto } from './checkout.dto';
import { shippingFeeFor, subtotalOf, totalOf } from './order-pricing';
import { failureError } from './saga.types';

const IDEMPOTENCY_KEY_MAX = 100;

export type CheckoutResult =
  | { status: 201; body: ReturnType<typeof createdBody> }
  | { status: 202; body: ReturnType<typeof processingBody> };

// Shape 201 như be/ trả (số, không phải chuỗi bigint), thêm payment_expires_at (NT.ORDER_HOLD, T3.10)
function createdBody(o: Order) {
  return {
    id: o.id,
    subtotal: Number(o.subtotal),
    shipping_fee: Number(o.shipping_fee),
    discount_amount: Number(o.discount_amount),
    shipping_discount_amount: Number(o.shipping_discount_amount),
    total: Number(o.total),
    status: o.status,
    shipping_address: {
      full_address: o.shipping_full_address,
      recipient_name: o.shipping_recipient_name,
      phone_number: o.shipping_phone_number,
    },
    created_at: o.created_at,
    payment_expires_at: o.payment_expires_at ?? null,
  };
}

function processingBody(o: Order) {
  return {
    id: o.id,
    status: 'processing' as const,
    message: 'Đơn hàng đang được xử lý, vui lòng kiểm tra lại sau',
  };
}

@Injectable()
export class CheckoutService {
  private readonly cfg: CheckoutConfig;

  constructor(
    @InjectRepository(Cart)
    private readonly cartRepo: Repository<Cart>,
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
    private readonly dataSource: DataSource,
    private readonly identity: IdentityClient,
    private readonly catalog: CatalogClient,
    private readonly saga: CheckoutSagaService,
    config: ConfigService,
  ) {
    this.cfg = config.getOrThrow<CheckoutConfig>('checkout');
  }

  async checkout(
    userId: string,
    dto: CreateOrderDto,
    idempotencyKey?: string,
  ): Promise<CheckoutResult> {
    const key = idempotencyKey || null;
    if (key && key.length > IDEMPOTENCY_KEY_MAX) {
      throw new BusinessException(
        400,
        GEN_ERROR.INVALID_INPUT,
        `Idempotency-Key tối đa ${IDEMPOTENCY_KEY_MAX} ký tự`,
      );
    }
    // Ngân sách cả request, gồm cả bước kiểm tra đầu vào (API_Spec §5)
    const deadline = Date.now() + this.cfg.budgetMs;

    // #1 Key đã dùng → trả kết quả cũ
    if (key) {
      const existing = await this.findByKey(userId, key);
      if (existing) return this.replay(existing);
    }

    // #2, #3 Giỏ (order_db) — trước lời gọi identity (v1.5)
    const cart = await this.cartRepo
      .createQueryBuilder('cart')
      .leftJoinAndSelect('cart.items', 'item')
      .where('cart.user_id = :userId', { userId })
      .getOne();
    if (!cart || !cart.items.length) throw cartEmpty();

    // Người mua tick chọn từng dòng ở màn Giỏ hàng: chỉ những dòng được gửi lên mới vào đơn, phần
    // còn lại ở nguyên trong giỏ. Không gửi cart_item_ids = đặt cả giỏ (như be/).
    let cartItems: CartItem[] = cart.items;
    if (dto.cart_item_ids?.length) {
      const selected = new Set(dto.cart_item_ids);
      cartItems = cart.items.filter((item) => selected.has(item.id));
      if (cartItems.length !== selected.size) throw cartItemGone();
    }

    // #4–#6 Gọi song song cho nhanh, nhưng xét lỗi đúng thứ tự địa chỉ → người mua → sản phẩm
    const [addressR, userR, productsR] = await Promise.allSettled([
      this.identity.getAddress(userId, dto.address_id, { deadline }),
      this.identity.getUser(userId, { deadline }),
      this.catalog.getProducts(
        cartItems.map((i) => i.product_id),
        { deadline },
      ),
    ]);
    const address = this.addressOrThrow(addressR);
    const user = settledOrThrow(userR);
    const products = new Map(settledOrThrow(productsR).map((p) => [p.id, p]));

    const lines = cartItems.map((item) => {
      const p = products.get(item.product_id);
      if (!p || !p.is_active) {
        throw productUnavailable(p?.name ?? item.product_id);
      }
      return { item, product: p, unit_price: Number(p.price) };
    });

    // Giá lấy ở bước này và lưu vào order_items (Processing_Flow §1)
    const subtotal = subtotalOf(
      lines.map((l) => ({
        unit_price: l.unit_price,
        quantity: l.item.quantity,
      })),
    );
    const shippingFee = shippingFeeFor(subtotal, this.cfg);

    let order: Order;
    try {
      order = await this.createOrder({
        userId,
        dto,
        key,
        cart,
        address,
        user,
        lines,
        subtotal,
        shippingFee,
      });
    } catch (err) {
      // #1, #7 do unique index bảo đảm khi hai request cùng vượt bước đọc. Cùng key thì cũng cùng giỏ:
      // INSERT vi phạm cả hai index, Postgres báo index nào trước là không chắc → có key thì tìm theo key
      // trước. Lúc nhận lỗi, đơn kia đã commit (Postgres chờ nó xong mới báo trùng).
      const idem = isUniqueViolation(err, 'ux_orders_idempotency');
      const cartBusy = isUniqueViolation(err, 'ux_orders_cart_processing');
      if (key && (idem || cartBusy)) {
        const existing = await this.findByKey(userId, key);
        if (existing) return this.replay(existing);
      }
      if (cartBusy) throw orderInProgress();
      throw err;
    }

    const outcome = await this.saga.advance(order, deadline);
    if (outcome.kind === 'confirmed') {
      return { status: 201, body: createdBody(outcome.order) };
    }
    if (outcome.kind === 'failed') throw outcome.error;
    // Chưa rõ: cron làm tiếp, báo người dùng khi có kết quả (outbox ở T4.1)
    await this.orderRepo.update({ id: order.id }, { notify_on_finish: true });
    return { status: 202, body: processingBody(outcome.order) };
  }

  private findByKey(userId: string, key: string): Promise<Order | null> {
    return this.orderRepo.findOne({
      where: { user_id: userId, idempotency_key: key },
    });
  }

  // API_Spec §1 #1. Đơn failed vì lỗi hạ tầng đã nhả key (T3.4) nên không tới đây.
  private replay(order: Order): CheckoutResult {
    if (order.status === 'processing') {
      return { status: 202, body: processingBody(order) };
    }
    if (order.status === 'failed') throw failureError(order);
    return { status: 201, body: createdBody(order) };
  }

  // identity 404 (địa chỉ không có hoặc không thuộc người này) → 1002 như be/; lỗi khác giữ nguyên
  private addressOrThrow(
    r: PromiseSettledResult<IdentityAddress>,
  ): IdentityAddress {
    if (r.status === 'fulfilled') return r.value;
    const err: unknown = r.reason;
    if (err instanceof UpstreamBusinessError && err.getStatus() === 404) {
      throw invalidAddress();
    }
    throw err;
  }

  // INSERT orders + order_items (insert lô) trong một transaction: 2 truy vấn
  private createOrder(a: {
    userId: string;
    dto: CreateOrderDto;
    key: string | null;
    cart: Cart;
    address: IdentityAddress;
    user: IdentityUser;
    lines: Array<{
      item: CartItem;
      product: CatalogProduct;
      unit_price: number;
    }>;
    subtotal: number;
    shippingFee: number;
  }): Promise<Order> {
    return this.dataSource.transaction(async (m) => {
      const saved = await m.save(
        m.create(Order, {
          user_id: a.userId,
          cart_id: a.cart.id,
          address_id: a.address.id,
          customer_name: a.user.full_name,
          customer_email: a.user.email,
          customer_phone: a.user.phone_number,
          shipping_full_address: a.address.full_address,
          shipping_recipient_name: a.address.recipient_name ?? null,
          shipping_phone_number: a.address.phone_number ?? null,
          discount_code: a.dto.discount_code ?? null,
          freeship_code: a.dto.freeship_code ?? null,
          subtotal: String(a.subtotal),
          shipping_fee: String(a.shippingFee),
          // Số tiền giảm do promotion trả ở bước dùng mã (setStep promotion_redeemed)
          discount_amount: '0',
          shipping_discount_amount: '0',
          total: String(totalOf(a.subtotal, a.shippingFee)),
          status: 'processing',
          note: a.dto.note ?? null,
          saga_step: 'started',
          saga_deadline: new Date(Date.now() + this.cfg.deadlineMs),
          selected_cart_item_ids: a.lines.map((l) => l.item.id),
          idempotency_key: a.key,
        }),
      );
      const items = a.lines.map((l) => ({
        order_id: saved.id,
        product_id: l.item.product_id,
        product_name: l.product.name,
        product_image: l.product.image,
        quantity: l.item.quantity,
        unit_price: String(l.unit_price),
      }));
      await m.insert(OrderItem, items);
      return { ...saved, items } as Order;
    });
  }
}

function settledOrThrow<T>(r: PromiseSettledResult<T>): T {
  if (r.status === 'fulfilled') return r.value;
  throw r.reason as HttpException;
}
