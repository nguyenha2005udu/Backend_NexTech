import type { Repository } from 'typeorm';
import { BusinessException } from '@nextech/service-kit';
import { DiscountCode } from '../../database/entities/discount-code.entity';
import { AdminDiscountCodeService } from './discount-code.admin.service';

// Hành vi giữ nguyên be/src/admin/discountcode/discountcode.admin.service.ts;
// chỉ thêm mã lỗi NT-PRM-1010, NT-PRM-1011 (ADR-0009), giữ câu chữ của be/.

const DAY = 24 * 60 * 60 * 1000;

function code(over: Partial<DiscountCode> = {}): DiscountCode {
  return {
    id: 'd1',
    code: 'SALE10',
    description: null,
    category: 'order',
    discount_type: 'percent',
    discount_value: 10,
    min_order_value: null,
    max_discount: null,
    usage_limit: null,
    used_count: 0,
    valid_from: new Date(Date.now() - DAY),
    valid_until: null,
    is_active: true,
    created_at: new Date(),
    ...over,
  };
}

async function expectBusiness(
  p: Promise<unknown>,
  status: number,
  codeValue: string,
  message: string,
) {
  const err = await p.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(BusinessException);
  const be = err as BusinessException;
  expect(be.getStatus()).toBe(status);
  expect(be.code).toBe(codeValue);
  expect(be.message).toBe(message);
}

describe('AdminDiscountCodeService', () => {
  let repo: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let service: AdminDiscountCodeService;

  beforeEach(() => {
    repo = {
      findOne: jest.fn(),
      create: jest.fn((x: unknown) => x),
      save: jest.fn((x: unknown) =>
        Promise.resolve({ id: 'new', ...(x as object) }),
      ),
      createQueryBuilder: jest.fn(),
    };
    service = new AdminDiscountCodeService(
      repo as unknown as Repository<DiscountCode>,
    );
  });

  it('create: mã đã có → 409 NT-PRM-1011', async () => {
    repo.findOne.mockResolvedValue(code());
    await expectBusiness(
      service.create({
        code: 'SALE10',
        discount_type: 'percent',
        discount_value: 10,
      }),
      409,
      'NT-PRM-1011',
      'Mã giảm giá đã tồn tại',
    );
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('create: mặc định category order, trả bản ghi đã lưu', async () => {
    repo.findOne.mockResolvedValue(null);
    const res = await service.create({
      code: 'NEW',
      discount_type: 'fixed_amount',
      discount_value: 5000,
    });
    expect(res).toMatchObject({
      id: 'new',
      code: 'NEW',
      category: 'order',
      discount_type: 'fixed_amount',
      discount_value: 5000,
      usage_limit: null,
    });
  });

  it('update: không tìm thấy → 404 NT-PRM-1010', async () => {
    repo.findOne.mockResolvedValue(null);
    await expectBusiness(
      service.update('x', { discount_value: 5 }),
      404,
      'NT-PRM-1010',
      'Không tìm thấy mã giảm giá',
    );
  });

  it('update: chỉ đổi trường được gửi', async () => {
    repo.findOne.mockResolvedValue(code());
    const res = await service.update('d1', { usage_limit: 5 });
    expect(res).toMatchObject({ id: 'd1', usage_limit: 5, discount_value: 10 });
  });

  it('remove: vô hiệu hoá, không xoá', async () => {
    repo.findOne.mockResolvedValue(code());
    await expect(service.remove('d1')).resolves.toEqual({
      message: 'Đã vô hiệu hoá mã giảm giá',
    });
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'd1', is_active: false }),
    );
  });

  it('remove: không tìm thấy → 404 NT-PRM-1010', async () => {
    repo.findOne.mockResolvedValue(null);
    await expectBusiness(
      service.remove('x'),
      404,
      'NT-PRM-1010',
      'Không tìm thấy mã giảm giá',
    );
  });

  it('findAll: tính status running/paused', async () => {
    const qb: Record<string, jest.Mock> = {};
    for (const m of ['andWhere', 'orderBy', 'skip', 'take']) {
      qb[m] = jest.fn(() => qb);
    }
    qb.getManyAndCount = jest
      .fn()
      .mockResolvedValue([[code(), code({ id: 'd2', is_active: false })], 2]);
    repo.createQueryBuilder.mockReturnValue(qb);

    const res = await service.findAll({ page: 1, limit: 20 });

    expect(res.items.map((i) => i.status)).toEqual(['running', 'paused']);
    expect(res).toMatchObject({ total: 2, page: 1, limit: 20, totalPages: 1 });
  });
});
