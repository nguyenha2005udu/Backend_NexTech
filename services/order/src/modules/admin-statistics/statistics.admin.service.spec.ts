import { UpstreamBusinessError, UpstreamError } from '@nextech/service-kit';
import type { Repository } from 'typeorm';
import type { CatalogClient } from '../../clients/catalog.client';
import type { IdentityClient } from '../../clients/identity.client';
import type { Order } from '../../database/entities/order.entity';
import type { PaymentCoreService } from '../payment/payment-core.service';
import { AdminStatisticsService } from './statistics.admin.service';

// GET /api/admin/statistics/overview — NT.ORDER v1.7: API_Spec mục overview, Component_Class_Design §6, §7
// "Overview khi catalog chết". Đếm đơn, lọc from/to: statistics.admin.service.int-spec.ts (Postgres thật).

describe('AdminStatisticsService.getOverview', () => {
  // QueryBuilder giả: mọi hàm nối trả chính nó
  const qb = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getCount: jest.fn(),
    getRawMany: jest.fn(),
  };
  const orderRepo = { createQueryBuilder: jest.fn(() => qb) };
  const paymentCore = { sumRevenue: jest.fn() };
  const catalog = { stats: jest.fn() };
  const identity = { stats: jest.fn() };
  const service = new AdminStatisticsService(
    orderRepo as unknown as Repository<Order>,
    paymentCore as unknown as PaymentCoreService,
    catalog as unknown as CatalogClient,
    identity as unknown as IdentityClient,
  );

  const catalogDown = () =>
    catalog.stats.mockRejectedValue(
      new UpstreamError('catalog', 'ECONNREFUSED', 'not_executed'),
    );
  const identityDown = () =>
    identity.stats.mockRejectedValue(
      new UpstreamError('identity', 'timeout', 'unknown', 504),
    );

  beforeEach(() => {
    jest.clearAllMocks();
    qb.getCount.mockResolvedValue(100);
    qb.getRawMany.mockResolvedValue([{ status: 'paid', count: '10' }]);
    paymentCore.sumRevenue.mockResolvedValue(15000000);
    catalog.stats.mockResolvedValue({
      total_products: 40,
      active_products: 35,
    });
    identity.stats.mockResolvedValue({ total_users: 50 });
  });

  it('đủ dữ liệu → shape be/, unavailable: []', async () => {
    expect(await service.getOverview({})).toEqual({
      total_orders: 100,
      total_revenue: 15000000,
      total_products: 40,
      active_products: 35,
      total_users: 50,
      orders_by_status: [{ status: 'paid', count: 10 }],
      unavailable: [],
    });
  });

  it('catalog chết → total_products, active_products null, unavailable ["catalog"], vẫn có doanh thu', async () => {
    catalogDown();
    const r = await service.getOverview({});
    expect(r.total_products).toBeNull();
    expect(r.active_products).toBeNull();
    expect(r.unavailable).toEqual(['catalog']);
    expect(r.total_revenue).toBe(15000000);
    expect(r.total_orders).toBe(100);
    expect(r.total_users).toBe(50);
  });

  it('identity chết → total_users null, unavailable ["identity"]', async () => {
    identityDown();
    const r = await service.getOverview({});
    expect(r.total_users).toBeNull();
    expect(r.total_products).toBe(40);
    expect(r.unavailable).toEqual(['identity']);
  });

  it('cả hai chết → unavailable theo thứ tự catalog, identity', async () => {
    catalogDown();
    identityDown();
    const r = await service.getOverview({});
    expect(r.unavailable).toEqual(['catalog', 'identity']);
    expect(r.total_products).toBeNull();
    expect(r.total_users).toBeNull();
  });

  it('lỗi không phải UpstreamError → ném tiếp', async () => {
    const err = new UpstreamBusinessError('catalog', 400, undefined, 'x');
    catalog.stats.mockRejectedValue(err);
    await expect(service.getOverview({})).rejects.toBe(err);
  });

  it('from/to → Date cho sumRevenue và lọc created_at của đơn (như be/)', async () => {
    await service.getOverview({
      from: '2026-11-01',
      to: '2026-11-30T23:59:59Z',
    });
    const from = new Date('2026-11-01');
    const to = new Date('2026-11-30T23:59:59Z');
    expect(paymentCore.sumRevenue).toHaveBeenCalledWith(from, to);
    expect(qb.andWhere).toHaveBeenCalledWith('order.created_at >= :from', {
      from,
    });
    expect(qb.andWhere).toHaveBeenCalledWith('order.created_at <= :to', { to });
  });

  it('không có from/to → không lọc, sumRevenue(undefined, undefined)', async () => {
    await service.getOverview({});
    expect(qb.andWhere).not.toHaveBeenCalled();
    expect(paymentCore.sumRevenue).toHaveBeenCalledWith(undefined, undefined);
  });
});
