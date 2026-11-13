import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BusinessException } from '@nextech/service-kit';
import { DiscountCode } from '../../database/entities/discount-code.entity';
import { PRM_ERROR } from '../../errors';
import {
  CreateDiscountCodeDto,
  QueryDiscountCodeDto,
  UpdateDiscountCodeDto,
} from './discount-code.admin.dto';

// Chép từ be/src/admin/discountcode/discountcode.admin.service.ts.
// Chỉ đổi: NotFoundException → NT-PRM-1010, ConflictException → NT-PRM-1011 (giữ câu chữ).
@Injectable()
export class AdminDiscountCodeService {
  constructor(
    @InjectRepository(DiscountCode)
    private readonly discountRepo: Repository<DiscountCode>,
  ) {}

  private async findOrFail(id: string): Promise<DiscountCode> {
    const discount = await this.discountRepo.findOne({ where: { id } });
    if (!discount) {
      throw new BusinessException(
        HttpStatus.NOT_FOUND,
        PRM_ERROR.DISCOUNT_NOT_FOUND,
        'Không tìm thấy mã giảm giá',
      );
    }
    return discount;
  }

  private computeStatus(discount: DiscountCode): 'running' | 'paused' {
    if (!discount.is_active) return 'paused';

    const now = new Date();
    if (discount.valid_from && new Date(discount.valid_from) > now) {
      return 'paused';
    }
    if (discount.valid_until && new Date(discount.valid_until) < now) {
      return 'paused';
    }
    return 'running';
  }

  // GET /api/admin/discount-codes
  async findAll(query: QueryDiscountCodeDto) {
    const { search, category, isActive, status, page = 1, limit = 20 } = query;

    const qb = this.discountRepo.createQueryBuilder('d');

    if (search) {
      qb.andWhere('d.code ILIKE :search', { search: `%${search}%` });
    }

    if (category) {
      qb.andWhere('d.category = :category', { category });
    }

    if (isActive !== undefined) {
      qb.andWhere('d.is_active = :isActive', { isActive });
    }

    if (status === 'running') {
      qb.andWhere('d.is_active = true')
        .andWhere('(d.valid_from IS NULL OR d.valid_from <= NOW())')
        .andWhere('(d.valid_until IS NULL OR d.valid_until >= NOW())');
    } else if (status === 'paused') {
      qb.andWhere(
        '(d.is_active = false OR (d.valid_from IS NOT NULL AND d.valid_from > NOW()) OR (d.valid_until IS NOT NULL AND d.valid_until < NOW()))',
      );
    }

    qb.orderBy('d.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [items, total] = await qb.getManyAndCount();

    return {
      items: items.map((d) => {
        const isLegacyFreeship =
          (d.discount_type as string) === 'free_shipping';
        return {
          id: d.id,
          code: d.code,
          description: d.description,
          category: isLegacyFreeship
            ? 'free_shipping'
            : (d.category ?? 'order'),
          discount_type: isLegacyFreeship
            ? 'fixed_amount'
            : (d.discount_type ?? 'percent'),
          discount_value: d.discount_value,
          min_order_value: d.min_order_value,
          max_discount: d.max_discount,
          usage_limit: d.usage_limit,
          used_count: d.used_count,
          valid_from: d.valid_from,
          valid_until: d.valid_until,
          is_active: d.is_active,
          status: this.computeStatus(d),
        };
      }),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // POST /api/admin/discount-codes
  async create(dto: CreateDiscountCodeDto) {
    const existed = await this.discountRepo.findOne({
      where: { code: dto.code },
    });
    if (existed) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        PRM_ERROR.DISCOUNT_EXISTS,
        'Mã giảm giá đã tồn tại',
      );
    }

    const discount = this.discountRepo.create({
      code: dto.code,
      description: dto.description ?? null,
      category: dto.category ?? 'order',
      discount_type: dto.discount_type,
      discount_value: dto.discount_value,
      min_order_value: dto.min_order_value ?? null,
      max_discount: dto.max_discount ?? null,
      usage_limit: dto.usage_limit ?? null,
      valid_from: dto.valid_from ? new Date(dto.valid_from) : undefined,
      valid_until: dto.valid_until ? new Date(dto.valid_until) : null,
      // Cho phép tạo mã ở trạng thái tắt sẵn; mặc định bật nếu FE không gửi.
      is_active: dto.is_active ?? undefined,
    });
    const saved = await this.discountRepo.save(discount);

    return {
      id: saved.id,
      code: saved.code,
      description: saved.description,
      category: saved.category,
      discount_type: saved.discount_type,
      discount_value: saved.discount_value,
      min_order_value: saved.min_order_value,
      max_discount: saved.max_discount,
      usage_limit: saved.usage_limit,
      valid_from: saved.valid_from,
      valid_until: saved.valid_until,
      is_active: saved.is_active,
    };
  }

  // PUT /api/admin/discount-codes/:id
  async update(id: string, dto: UpdateDiscountCodeDto) {
    const discount = await this.findOrFail(id);

    if (dto.category !== undefined) discount.category = dto.category;
    if (dto.discount_type !== undefined)
      discount.discount_type = dto.discount_type;
    if (dto.discount_value !== undefined)
      discount.discount_value = dto.discount_value;
    if (dto.min_order_value !== undefined)
      discount.min_order_value = dto.min_order_value;
    if (dto.max_discount !== undefined)
      discount.max_discount = dto.max_discount;
    if (dto.description !== undefined) discount.description = dto.description;
    if (dto.usage_limit !== undefined) discount.usage_limit = dto.usage_limit;
    if (dto.valid_from !== undefined)
      discount.valid_from = new Date(dto.valid_from);
    if (dto.valid_until !== undefined)
      discount.valid_until = new Date(dto.valid_until);
    if (dto.is_active !== undefined) discount.is_active = dto.is_active;

    const saved = await this.discountRepo.save(discount);

    return {
      id: saved.id,
      category: saved.category,
      discount_type: saved.discount_type,
      discount_value: saved.discount_value,
      usage_limit: saved.usage_limit,
      valid_from: saved.valid_from,
      valid_until: saved.valid_until,
      is_active: saved.is_active,
    };
  }

  // DELETE /api/admin/discount-codes/:id
  async remove(id: string) {
    const discount = await this.findOrFail(id);
    discount.is_active = false;
    await this.discountRepo.save(discount);
    return { message: 'Đã vô hiệu hoá mã giảm giá' };
  }
}
