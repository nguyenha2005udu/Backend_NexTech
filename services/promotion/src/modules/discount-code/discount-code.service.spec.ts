import type { Repository } from 'typeorm';
import { DiscountCode } from '../../database/entities/discount-code.entity';
import { DiscountCodeService } from './discount-code.service';

// Hành vi giữ nguyên be/src/users/discountcode/discountcode.service.ts:
// mã sai trả 200 với is_valid: false, không ném lỗi (NT.PROMOTION API_Spec §1 #3).

const DAY = 24 * 60 * 60 * 1000;

function code(over: Partial<DiscountCode> = {}): DiscountCode {
  return {
    id: 'd1',
    code: 'SALE10',
    description: null,
    category: 'order',
    discount_type: 'percent',
    discount_value: '10' as unknown as number,
    min_order_value: null,
    max_discount: '200000' as unknown as number,
    usage_limit: null,
    used_count: 0,
    valid_from: new Date(Date.now() - DAY),
    valid_until: null,
    is_active: true,
    created_at: new Date(),
    ...over,
  };
}

function qbMock(rows: DiscountCode[], total: number) {
  const qb: Record<string, jest.Mock> = {};
  for (const m of ['where', 'andWhere', 'orderBy', 'skip', 'take']) {
    qb[m] = jest.fn(() => qb);
  }
  qb.getManyAndCount = jest.fn().mockResolvedValue([rows, total]);
  return qb;
}

describe('DiscountCodeService', () => {
  let repo: { findOne: jest.Mock; createQueryBuilder: jest.Mock };
  let service: DiscountCodeService;

  beforeEach(() => {
    repo = { findOne: jest.fn(), createQueryBuilder: jest.fn() };
    service = new DiscountCodeService(
      repo as unknown as Repository<DiscountCode>,
    );
  });

  describe('validate', () => {
    it('mã không tồn tại → is_valid false', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(
        service.validate({ code: 'XX', order_value: 100 }),
      ).resolves.toEqual({
        code: 'XX',
        is_valid: false,
        message: 'Mã giảm giá không tồn tại',
      });
    });

    it.each([
      [{ is_active: false }, 'Mã giảm giá đã bị vô hiệu hoá'],
      [{ valid_until: new Date(Date.now() - DAY) }, 'Mã giảm giá đã hết hạn'],
      [
        { valid_from: new Date(Date.now() + DAY) },
        'Mã giảm giá chưa có hiệu lực',
      ],
      [{ usage_limit: 1, used_count: 1 }, 'Mã giảm giá đã hết lượt sử dụng'],
      [
        { min_order_value: '50000000' as unknown as number },
        'Đơn hàng tối thiểu 50.000.000đ để áp dụng mã này',
      ],
    ])('%o → is_valid false, discount_amount 0', async (over, message) => {
      repo.findOne.mockResolvedValue(code(over));
      const res = await service.validate({
        code: 'SALE10',
        order_value: 1_500_000,
      });
      expect(res).toMatchObject({
        is_valid: false,
        message,
        discount_amount: 0,
      });
    });

    it('mã order hợp lệ: tính trên order_value, không có message', async () => {
      repo.findOne.mockResolvedValue(code());
      const res = await service.validate({
        code: 'SALE10',
        order_value: 1_500_000,
        shipping_fee: 30_000,
      });
      expect(res).toEqual({
        code: 'SALE10',
        category: 'order',
        discount_type: 'percent',
        discount_value: '10',
        discount_amount: 150_000,
        min_order_value: null,
        max_discount: '200000',
        is_valid: true,
      });
    });

    it('mã free_shipping hợp lệ: tính trên shipping_fee', async () => {
      repo.findOne.mockResolvedValue(
        code({
          code: 'SHIP30',
          category: 'free_shipping',
          discount_type: 'fixed_amount',
          discount_value: '30000' as unknown as number,
          max_discount: null,
        }),
      );
      const res = await service.validate({
        code: 'SHIP30',
        order_value: 1_500_000,
        shipping_fee: 20_000,
      });
      expect(res).toMatchObject({ is_valid: true, discount_amount: 20_000 });
    });
  });

  describe('listDiscountCodes / listFreeshipCodes', () => {
    it('trả shape phân trang, mã free_shipping kiểu cũ hiện là free_shipping + fixed_amount', async () => {
      const legacy = code({
        code: 'OLD',
        discount_type: 'free_shipping' as DiscountCode['discount_type'],
      });
      const qb = qbMock([legacy], 21);
      repo.createQueryBuilder.mockReturnValue(qb);

      const res = await service.listFreeshipCodes({ page: 2, limit: 20 });

      expect(qb.skip).toHaveBeenCalledWith(20);
      expect(qb.take).toHaveBeenCalledWith(20);
      expect(res).toMatchObject({
        total: 21,
        page: 2,
        limit: 20,
        totalPages: 2,
        items: [
          {
            code: 'OLD',
            category: 'free_shipping',
            discount_type: 'fixed_amount',
          },
        ],
      });
    });

    it('có order_value thì lọc thêm min_order_value', async () => {
      const qb = qbMock([], 0);
      repo.createQueryBuilder.mockReturnValue(qb);
      await service.listDiscountCodes({ order_value: 100_000 });
      expect(qb.andWhere).toHaveBeenCalledWith(
        '(d.min_order_value IS NULL OR d.min_order_value <= :orderValue)',
        { orderValue: 100_000 },
      );
    });
  });
});
