import type { DataSource } from 'typeorm';
import { BusinessException } from '@nextech/service-kit';
import { DiscountCode } from '../../database/entities/discount-code.entity';
import {
  Redemption,
  RedemptionStatus,
} from '../../database/entities/redemption.entity';
import { RedemptionService } from './redemption.service';

// Test đơn vị (mock EntityManager) cho thứ tự kiểm tra và mã lỗi — NT.PROMOTION Component_Class_Design §5.
// Các ca đồng thời, idempotent thật, release: redemption.service.int-spec.ts (Postgres thật).

const DAY = 24 * 60 * 60 * 1000;
const ORDER_ID = '11111111-1111-4111-8111-111111111111';

function code(over: Partial<DiscountCode> = {}): DiscountCode {
  return {
    id: 'id-' + (over.code ?? 'SALE10'),
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

const SHIP30 = code({
  code: 'SHIP30',
  category: 'free_shipping',
  discount_type: 'fixed_amount',
  discount_value: '30000' as unknown as number,
  max_discount: null,
});

interface Setup {
  /** Dòng redemptions đã có cho ORDER_ID (insert bị bỏ qua) */
  existing?: Partial<Redemption> & { status: RedemptionStatus };
  codes?: DiscountCode[];
  /** Số dòng UPDATE consume ảnh hưởng, theo thứ tự gọi */
  consumeAffected?: number[];
}

function setup(s: Setup = {}) {
  const codes = new Map((s.codes ?? []).map((c) => [c.code, c]));
  const consumeAffected = [...(s.consumeAffected ?? [])];
  const consumed: string[] = [];
  const updates: unknown[] = [];

  const qb = () => {
    let kind: 'insert' | 'update' = 'insert';
    let whereId: string | undefined;
    const chain: Record<string, jest.Mock> = {};
    for (const m of ['into', 'values', 'orIgnore', 'returning', 'set']) {
      chain[m] = jest.fn(() => chain);
    }
    chain.insert = jest.fn(() => ((kind = 'insert'), chain));
    chain.update = jest.fn(() => ((kind = 'update'), chain));
    chain.where = jest.fn((_sql: string, p: { id: string }) => {
      whereId = p.id;
      return chain;
    });
    chain.andWhere = jest.fn(() => chain);
    chain.execute = jest.fn(() => {
      if (kind === 'insert') {
        return Promise.resolve({
          raw: s.existing ? [] : [{ order_id: ORDER_ID }],
        });
      }
      consumed.push(whereId!);
      return Promise.resolve({ affected: consumeAffected.shift() ?? 1 });
    });
    return chain;
  };

  const manager = {
    createQueryBuilder: jest.fn(qb),
    findOne: jest.fn((_e: unknown, opts: { where: { code: string } }) =>
      Promise.resolve(codes.get(opts.where.code) ?? null),
    ),
    findOneByOrFail: jest.fn(() =>
      Promise.resolve({
        order_id: ORDER_ID,
        discount_code_id: null,
        freeship_code_id: null,
        discount_amount: '0',
        shipping_discount_amount: '0',
        ...s.existing,
      }),
    ),
    update: jest.fn((_e: unknown, _w: unknown, v: unknown) => {
      updates.push(v);
      return Promise.resolve({ affected: 1 });
    }),
  };
  const dataSource = {
    transaction: jest.fn((cb: (m: typeof manager) => unknown) => cb(manager)),
  };
  const service = new RedemptionService(dataSource as unknown as DataSource);
  return { service, manager, consumed, updates };
}

const base = {
  order_id: ORDER_ID,
  subtotal: 1_500_000,
  shipping_fee: 30_000,
};

async function expectBusiness(
  p: Promise<unknown>,
  status: number,
  errCode: string,
  message?: string,
) {
  const err = await p.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(BusinessException);
  const be = err as BusinessException;
  expect({ status: be.getStatus(), code: be.code }).toEqual({
    status,
    code: errCode,
  });
  if (message !== undefined) expect(be.message).toBe(message);
}

describe('RedemptionService.redeem', () => {
  it('mã order + freeship hợp lệ: tính tiền, tăng lượt từng mã, created=true', async () => {
    const { service, consumed, updates } = setup({ codes: [code(), SHIP30] });

    const res = await service.redeem({
      ...base,
      discount_code: 'SALE10',
      freeship_code: 'SHIP30',
    });

    expect(res).toEqual({
      created: true,
      redemption: {
        order_id: ORDER_ID,
        status: 'redeemed',
        discount_code_id: 'id-SALE10',
        freeship_code_id: 'id-SHIP30',
        discount_amount: 150_000,
        shipping_discount_amount: 30_000,
      },
    });
    expect(consumed).toEqual(['id-SALE10', 'id-SHIP30']);
    expect(updates).toHaveLength(1);
  });

  it('thiếu cả hai mã → 400 NT-GEN-0001, không mở transaction', async () => {
    const { service, manager } = setup();
    await expectBusiness(service.redeem({ ...base }), 400, 'NT-GEN-0001');
    expect(manager.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('đã có redeemed → trả kết quả cũ, created=false, không kiểm tra lại mã', async () => {
    const { service, manager, consumed } = setup({
      existing: {
        status: 'redeemed',
        discount_code_id: 'id-SALE10',
        discount_amount: '150000' as unknown as number,
      },
    });
    const res = await service.redeem({ ...base, discount_code: 'SALE10' });
    expect(res).toEqual({
      created: false,
      redemption: {
        order_id: ORDER_ID,
        status: 'redeemed',
        discount_code_id: 'id-SALE10',
        freeship_code_id: null,
        discount_amount: 150_000,
        shipping_discount_amount: 0,
      },
    });
    expect(manager.findOne).not.toHaveBeenCalled();
    expect(consumed).toEqual([]);
  });

  it('đã có released → 409 NT-PRM-1008', async () => {
    const { service } = setup({ existing: { status: 'released' } });
    await expectBusiness(
      service.redeem({ ...base, discount_code: 'SALE10' }),
      409,
      'NT-PRM-1008',
      'Lượt dùng mã của đơn này đã bị huỷ',
    );
  });

  it('hai trường cùng một mã order → 400 NT-PRM-1002 (BR-03)', async () => {
    const { service, consumed } = setup({ codes: [code()] });
    await expectBusiness(
      service.redeem({
        ...base,
        discount_code: 'SALE10',
        freeship_code: 'SALE10',
      }),
      400,
      'NT-PRM-1002',
      'Không thể dùng cùng một mã cho cả discount_code và freeship_code',
    );
    expect(consumed).toEqual([]);
  });

  it('hai trường cùng một mã freeship → lỗi sai loại của discount_code trước (thứ tự be/, van-de A5)', async () => {
    const { service } = setup({ codes: [SHIP30] });
    await expectBusiness(
      service.redeem({
        ...base,
        discount_code: 'SHIP30',
        freeship_code: 'SHIP30',
      }),
      400,
      'NT-PRM-1003',
      'Mã "SHIP30" là mã miễn phí ship, vui lòng nhập vào trường freeship_code',
    );
  });

  it('mã không tồn tại → 400 NT-PRM-1001', async () => {
    const { service } = setup();
    await expectBusiness(
      service.redeem({ ...base, discount_code: 'XX' }),
      400,
      'NT-PRM-1001',
      'Mã "XX" không tồn tại',
    );
  });

  it('mã order đặt vào freeship_code → 400 NT-PRM-1003', async () => {
    const { service } = setup({ codes: [code()] });
    await expectBusiness(
      service.redeem({ ...base, freeship_code: 'SALE10' }),
      400,
      'NT-PRM-1003',
      'Mã "SALE10" không phải mã miễn phí ship, vui lòng nhập vào trường discount_code',
    );
  });

  it.each([
    [{ is_active: false }, 400, 'NT-PRM-1004', 'Mã "SALE10" đã bị vô hiệu hoá'],
    [
      { valid_until: new Date(Date.now() - DAY) },
      400,
      'NT-PRM-1005',
      'Mã "SALE10" đã hết hạn',
    ],
    [
      { valid_from: new Date(Date.now() + DAY) },
      400,
      'NT-PRM-1005',
      'Mã "SALE10" chưa có hiệu lực',
    ],
    [
      { usage_limit: 1, used_count: 1 },
      409,
      'NT-PRM-1006',
      'Mã "SALE10" đã hết lượt sử dụng',
    ],
    [
      { min_order_value: '50000000' as unknown as number },
      400,
      'NT-PRM-1007',
      'Đơn hàng tối thiểu 50.000.000đ để áp dụng mã "SALE10"',
    ],
  ])('%o → %i %s (BR-02)', async (over, status, errCode, message) => {
    const { service, consumed } = setup({ codes: [code(over)] });
    await expectBusiness(
      service.redeem({ ...base, discount_code: 'SALE10' }),
      status,
      errCode,
      message,
    );
    expect(consumed).toEqual([]);
  });

  it('mã thứ hai lỗi → không tăng lượt mã thứ nhất (kiểm tra hết rồi mới tăng)', async () => {
    const { service, consumed } = setup({
      codes: [code(), { ...SHIP30, is_active: false }],
    });
    await expectBusiness(
      service.redeem({
        ...base,
        discount_code: 'SALE10',
        freeship_code: 'SHIP30',
      }),
      400,
      'NT-PRM-1004',
    );
    expect(consumed).toEqual([]);
  });

  it('tăng lượt có điều kiện thất bại (mất lượt do đồng thời) → 409 NT-PRM-1006', async () => {
    const { service } = setup({ codes: [code()], consumeAffected: [0] });
    await expectBusiness(
      service.redeem({ ...base, discount_code: 'SALE10' }),
      409,
      'NT-PRM-1006',
      'Mã "SALE10" đã hết lượt sử dụng',
    );
  });
});
