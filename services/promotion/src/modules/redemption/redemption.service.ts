import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { BusinessException, GEN_ERROR } from '@nextech/service-kit';
import { DiscountCode } from '../../database/entities/discount-code.entity';
import { Redemption } from '../../database/entities/redemption.entity';
import { PRM_ERROR } from '../../errors';
import { calculate } from './discount-calculator';
import { RedeemDto } from './redeem.dto';

export interface RedemptionResponse {
  order_id: string;
  status: Redemption['status'];
  discount_code_id: string | null;
  freeship_code_id: string | null;
  discount_amount: number;
  shipping_discount_amount: number;
}

export interface RedeemResult {
  /** true: vừa ghi nhận (201). false: đã có từ trước, trả kết quả cũ (200) */
  created: boolean;
  redemption: RedemptionResponse;
}

function toResponse(
  r: Omit<RedemptionResponse, 'status'> & Pick<Redemption, 'status'>,
): RedemptionResponse {
  return {
    order_id: r.order_id,
    status: r.status,
    discount_code_id: r.discount_code_id ?? null,
    freeship_code_id: r.freeship_code_id ?? null,
    // bigint từ pg là chuỗi
    discount_amount: Number(r.discount_amount),
    shipping_discount_amount: Number(r.shipping_discount_amount),
  };
}

function bad(status: HttpStatus, code: string, message: string) {
  return new BusinessException(status, code, message);
}

// Ghi nhận / nhả lượt dùng mã cho một đơn (NT.PROMOTION Component_Class_Design §4).
// Luật kiểm tra, tính tiền, tăng/giảm lượt chép từ be/src/users/order/order.service.ts
// (validateDiscountCode, checkout) và order-inventory.util.ts (consumeDiscount, releaseOrderResources).
@Injectable()
export class RedemptionService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Idempotent theo order_id. Số truy vấn: mới tối đa 6 (insert, 2 đọc mã, 2 tăng lượt, cập nhật);
   * đã có 2 (insert bị bỏ qua, đọc).
   */
  async redeem(dto: RedeemDto): Promise<RedeemResult> {
    if (!dto.discount_code && !dto.freeship_code) {
      throw bad(
        HttpStatus.BAD_REQUEST,
        GEN_ERROR.INVALID_INPUT,
        'Cần ít nhất một trong discount_code, freeship_code',
      );
    }

    return this.dataSource.transaction(async (m) => {
      // Giữ chỗ cho order_id. Có redeem/release khác đang chạy cùng order_id thì Postgres chờ nó xong.
      const inserted = await m
        .createQueryBuilder()
        .insert()
        .into(Redemption)
        .values({ order_id: dto.order_id, status: 'redeemed' })
        .orIgnore()
        .returning('order_id')
        .execute();

      if (!(inserted.raw as unknown[]).length) {
        const existing = await m.findOneByOrFail(Redemption, {
          order_id: dto.order_id,
        });
        if (existing.status === 'released') {
          throw bad(
            HttpStatus.CONFLICT,
            PRM_ERROR.REDEMPTION_RELEASED,
            'Lượt dùng mã của đơn này đã bị huỷ',
          );
        }
        // Gọi lại: trả đúng số tiền lần đầu, kể cả khi admin vừa đổi mã
        return { created: false, redemption: toResponse(existing) };
      }

      // Thứ tự kiểm tra giữ như be/ checkout: discount_code → trùng mã → freeship_code (van-de A5)
      const order = dto.discount_code
        ? await this.validate(m, dto.discount_code, dto.subtotal, 'order')
        : null;

      let freeship: DiscountCode | null = null;
      if (dto.freeship_code) {
        if (dto.discount_code && dto.freeship_code === dto.discount_code) {
          throw bad(
            HttpStatus.BAD_REQUEST,
            PRM_ERROR.SAME_CODE_BOTH_FIELDS,
            'Không thể dùng cùng một mã cho cả discount_code và freeship_code',
          );
        }
        freeship = await this.validate(
          m,
          dto.freeship_code,
          dto.subtotal,
          'free_shipping',
        );
      }

      const values = {
        discount_code_id: order?.id ?? null,
        freeship_code_id: freeship?.id ?? null,
        discount_amount: order ? calculate(order, dto.subtotal) : 0,
        shipping_discount_amount: freeship
          ? calculate(freeship, dto.shipping_fee)
          : 0,
      };

      // Kiểm tra hết rồi mới tăng lượt; lỗi ở đây rollback cả dòng redemptions
      if (order) await this.consume(m, order);
      if (freeship) await this.consume(m, freeship);

      await m.update(Redemption, { order_id: dto.order_id }, values);
      return {
        created: true,
        redemption: toResponse({
          order_id: dto.order_id,
          status: 'redeemed',
          ...values,
        }),
      };
    });
  }

  /** Số truy vấn: 1 */
  async get(orderId: string): Promise<RedemptionResponse> {
    const r = await this.dataSource
      .getRepository(Redemption)
      .findOne({ where: { order_id: orderId } });
    if (!r) {
      throw bad(
        HttpStatus.NOT_FOUND,
        PRM_ERROR.REDEMPTION_NOT_FOUND,
        'Không tìm thấy lượt dùng mã',
      );
    }
    return toResponse(r);
  }

  /**
   * Idempotent, có thể chạy cùng lúc với một redeem chưa commit (Component_Class_Design §4 `release`).
   * Số truy vấn: tối đa 5 (chèn tombstone, khoá, trả lượt 2 mã, cập nhật).
   */
  async release(
    orderId: string,
  ): Promise<{ status: 'released'; restored: boolean }> {
    return this.dataSource.transaction(async (m) => {
      // Truy vấn thô: cần ON CONFLICT (order_id) DO NOTHING trước khi khoá — dòng chưa có thì
      // FOR UPDATE không khoá được gì, còn INSERT thường gặp redeem chưa commit sẽ lỗi 23505.
      // Postgres chờ redeem đang chạy commit/rollback trên khoá unique rồi mới quyết định.
      await m.query(
        `INSERT INTO redemptions (order_id, status, released_at) VALUES ($1, 'released', now())
         ON CONFLICT (order_id) DO NOTHING`,
        [orderId],
      );
      const r = await m.findOneOrFail(Redemption, {
        where: { order_id: orderId },
        lock: { mode: 'pessimistic_write' },
      });

      // Tombstone vừa chèn, hoặc đã nhả từ trước
      if (r.status === 'released')
        return { status: 'released', restored: false };

      // Trả lượt từng mã, ĐÚNG thứ tự redeem khoá (mã order rồi mới mã freeship). Không gộp thành
      // `WHERE id IN (...)`: Postgres không bảo đảm thứ tự khoá dòng, release đơn này và redeem đơn
      // khác cùng hai mã có thể khoá chéo (deadlock 40P01). Tối đa 2 lệnh — hằng số, không theo N.
      if (r.discount_code_id) await this.restore(m, r.discount_code_id);
      if (r.freeship_code_id) await this.restore(m, r.freeship_code_id);
      await m.update(
        Redemption,
        { order_id: orderId },
        { status: 'released', released_at: () => 'now()' },
      );
      return { status: 'released', restored: true };
    });
  }

  // Chép từ be/src/users/order/order.service.ts validateDiscountCode, gắn mã lỗi NT-PRM-*
  private async validate(
    m: EntityManager,
    code: string,
    subtotal: number,
    expectedCategory: 'order' | 'free_shipping',
  ): Promise<DiscountCode> {
    const discount = await m.findOne(DiscountCode, { where: { code } });
    if (!discount) {
      throw bad(
        HttpStatus.BAD_REQUEST,
        PRM_ERROR.CODE_NOT_FOUND,
        `Mã "${code}" không tồn tại`,
      );
    }

    const category = discount.category ?? 'order';
    if (category !== expectedCategory) {
      throw bad(
        HttpStatus.BAD_REQUEST,
        PRM_ERROR.WRONG_CATEGORY,
        expectedCategory === 'free_shipping'
          ? `Mã "${code}" không phải mã miễn phí ship, vui lòng nhập vào trường discount_code`
          : `Mã "${code}" là mã miễn phí ship, vui lòng nhập vào trường freeship_code`,
      );
    }

    const now = new Date();
    if (!discount.is_active) {
      throw bad(
        HttpStatus.BAD_REQUEST,
        PRM_ERROR.INACTIVE,
        `Mã "${code}" đã bị vô hiệu hoá`,
      );
    }
    if (discount.valid_until && now > new Date(discount.valid_until)) {
      throw bad(
        HttpStatus.BAD_REQUEST,
        PRM_ERROR.NOT_IN_VALID_PERIOD,
        `Mã "${code}" đã hết hạn`,
      );
    }
    if (discount.valid_from && now < new Date(discount.valid_from)) {
      throw bad(
        HttpStatus.BAD_REQUEST,
        PRM_ERROR.NOT_IN_VALID_PERIOD,
        `Mã "${code}" chưa có hiệu lực`,
      );
    }
    if (
      discount.usage_limit !== null &&
      discount.used_count >= discount.usage_limit
    ) {
      throw this.outOfUses(code);
    }
    if (
      discount.min_order_value !== null &&
      subtotal < Number(discount.min_order_value)
    ) {
      throw bad(
        HttpStatus.BAD_REQUEST,
        PRM_ERROR.BELOW_MIN_ORDER,
        `Đơn hàng tối thiểu ${Number(discount.min_order_value).toLocaleString('vi-VN')}đ để áp dụng mã "${code}"`,
      );
    }

    return discount;
  }

  // Chép từ be/src/users/order/order-inventory.util.ts consumeDiscount: tăng lượt nguyên tử,
  // chặn vượt usage_limit khi nhiều đơn dùng mã cùng lúc (BR-02)
  private async consume(m: EntityManager, discount: DiscountCode) {
    const result = await m
      .createQueryBuilder()
      .update(DiscountCode)
      .set({ used_count: () => 'used_count + 1' })
      .where('id = :id', { id: discount.id })
      .andWhere('(usage_limit IS NULL OR used_count < usage_limit)')
      .execute();

    if (!result.affected) throw this.outOfUses(discount.code);
  }

  // Chép từ be/src/users/order/order-inventory.util.ts releaseOrderResources (phần trả lượt mã)
  private async restore(m: EntityManager, discountId: string) {
    await m
      .createQueryBuilder()
      .update(DiscountCode)
      .set({ used_count: () => 'GREATEST(used_count - 1, 0)' })
      .where('id = :id', { id: discountId })
      .execute();
  }

  private outOfUses(code: string) {
    return bad(
      HttpStatus.CONFLICT,
      PRM_ERROR.OUT_OF_USES,
      `Mã "${code}" đã hết lượt sử dụng`,
    );
  }
}
