import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DiscountCode } from '../../database/entities/discount-code.entity';
import { calculate } from '../redemption/discount-calculator';
import {
  ListDiscountCodeDto,
  ValidateDiscountCodeDto,
} from './discount-code.dto';

// Chép từ be/src/users/discountcode/discountcode.service.ts. Chỉ đổi: phần tính tiền gọi
// discount-calculator (cùng công thức, cùng kết quả). Giữ nhánh legacy discount_type = 'free_shipping'.
@Injectable()
export class DiscountCodeService {
  constructor(
    @InjectRepository(DiscountCode)
    private readonly discountRepo: Repository<DiscountCode>,
  ) {}

  // Helper dùng chung cho 2 API list bên dưới
  private async listActiveCodes(
    category: 'order' | 'free_shipping',
    dto: ListDiscountCodeDto,
  ) {
    const { order_value, page = 1, limit = 20 } = dto;
    const now = new Date();

    const qb = this.discountRepo
      .createQueryBuilder('d')
      .where('d.is_active = :active', { active: true })
      .andWhere(
        category === 'free_shipping'
          ? '(d.category = :category OR d.discount_type = :legacyFreeship)'
          : '(d.category = :category AND d.discount_type != :legacyFreeship)',
        { category, legacyFreeship: 'free_shipping' },
      )
      .andWhere('(d.valid_from IS NULL OR d.valid_from <= :now)', { now })
      .andWhere('(d.valid_until IS NULL OR d.valid_until >= :now)', { now })
      .andWhere('(d.usage_limit IS NULL OR d.used_count < d.usage_limit)')
      .orderBy('d.created_at', 'DESC');

    // Lọc thêm theo order_value nếu FE truyền lên
    if (order_value !== undefined) {
      qb.andWhere(
        '(d.min_order_value IS NULL OR d.min_order_value <= :orderValue)',
        { orderValue: order_value },
      );
    }

    const [codes, total] = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return {
      items: codes.map((c) => {
        const isLegacyFreeship =
          (c.discount_type as string) === 'free_shipping';
        return {
          code: c.code,
          description: c.description,
          category: isLegacyFreeship
            ? 'free_shipping'
            : (c.category ?? 'order'),
          discount_type: isLegacyFreeship
            ? 'fixed_amount'
            : (c.discount_type ?? 'percent'),
          discount_value: c.discount_value,
          min_order_value: c.min_order_value,
          max_discount: c.max_discount,
          valid_until: c.valid_until,
        };
      }),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // ---------- GET /api/discount-codes ----------
  // Danh sách mã giảm giá thường (category = order)
  async listDiscountCodes(dto: ListDiscountCodeDto) {
    return this.listActiveCodes('order', dto);
  }

  // ---------- GET /api/discount-codes/freeship ----------
  // Danh sách mã miễn phí ship (category = free_shipping)
  async listFreeshipCodes(dto: ListDiscountCodeDto) {
    return this.listActiveCodes('free_shipping', dto);
  }

  // ---------- POST /api/discount-codes/validate ----------
  async validate(dto: ValidateDiscountCodeDto) {
    const discount = await this.discountRepo.findOne({
      where: { code: dto.code },
    });

    if (!discount) {
      return {
        code: dto.code,
        is_valid: false,
        message: 'Mã giảm giá không tồn tại',
      };
    }

    const now = new Date();
    let isValid = true;
    let message: string | undefined;

    if (!discount.is_active) {
      isValid = false;
      message = 'Mã giảm giá đã bị vô hiệu hoá';
    } else if (discount.valid_until && now > new Date(discount.valid_until)) {
      isValid = false;
      message = 'Mã giảm giá đã hết hạn';
    } else if (discount.valid_from && now < new Date(discount.valid_from)) {
      isValid = false;
      message = 'Mã giảm giá chưa có hiệu lực';
    } else if (
      discount.usage_limit !== null &&
      discount.used_count >= discount.usage_limit
    ) {
      isValid = false;
      message = 'Mã giảm giá đã hết lượt sử dụng';
    } else if (
      discount.min_order_value !== null &&
      dto.order_value < Number(discount.min_order_value)
    ) {
      isValid = false;
      message = `Đơn hàng tối thiểu ${Number(discount.min_order_value).toLocaleString('vi-VN')}đ để áp dụng mã này`;
    }

    const shippingFee = dto.shipping_fee ?? 0;
    let discountAmount = 0;

    if (isValid) {
      const category = discount.category ?? 'order';
      const targetBase =
        category === 'free_shipping' ? shippingFee : dto.order_value;
      discountAmount = calculate(discount, targetBase);
    }

    return {
      code: discount.code,
      category: discount.category ?? 'order',
      discount_type: discount.discount_type ?? 'percent',
      discount_value: discount.discount_value,
      discount_amount: discountAmount,
      min_order_value: discount.min_order_value,
      max_discount: discount.max_discount,
      is_valid: isValid,
      ...(message ? { message } : {}),
    };
  }
}
