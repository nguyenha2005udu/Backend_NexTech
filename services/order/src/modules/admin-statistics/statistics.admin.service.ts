// Chép getOverview từ be/src/admin/statistics/statistics.admin.service.ts (dòng 25–74). Đổi do tách service
// (NT.ORDER v1.7, Component_Class_Design §6): doanh thu qua PaymentCoreService.sumRevenue (cùng câu be/);
// productRepo.count, userRepo.count thay bằng CatalogClient.stats, IdentityClient.stats với allSettled —
// service lỗi (UpstreamError) thì phần đó null, tên vào `unavailable` (luôn trả, [] khi đủ).
// 3 truy vấn order_db; 2 lời gọi bắt đầu trước, chạy song song với truy vấn, không trong transaction.
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { UpstreamError } from '@nextech/service-kit';
import { Repository } from 'typeorm';
import { CatalogClient } from '../../clients/catalog.client';
import { IdentityClient } from '../../clients/identity.client';
import { Order } from '../../database/entities/order.entity';
import { PaymentCoreService } from '../payment/payment-core.service';
import { QueryOverviewStatsDto } from './statistics.admin.dto';

export interface OverviewStats {
  total_orders: number;
  total_revenue: number;
  total_products: number | null;
  active_products: number | null;
  total_users: number | null;
  orders_by_status: Array<{ status: string; count: number }>;
  unavailable: Array<'catalog' | 'identity'>;
}

// Kết quả allSettled → giá trị, hoặc null nếu UpstreamError. Lỗi khác ném tiếp (thiết kế §6).
function settledOrNull<T>(r: PromiseSettledResult<T>): T | null {
  if (r.status === 'fulfilled') return r.value;
  if (r.reason instanceof UpstreamError) return null;
  throw r.reason;
}

@Injectable()
export class AdminStatisticsService {
  constructor(
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
    private readonly paymentCore: PaymentCoreService,
    private readonly catalog: CatalogClient,
    private readonly identity: IdentityClient,
  ) {}

  // GET /api/admin/statistics/overview?from=&to=
  async getOverview(query: QueryOverviewStatsDto): Promise<OverviewStats> {
    const { from, to } = query;
    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;

    // Gọi trước để chạy song song với truy vấn order_db
    const remote = Promise.allSettled([
      this.catalog.stats(),
      this.identity.stats(),
    ]);

    const orderQb = this.orderRepo.createQueryBuilder('order');
    if (fromDate)
      orderQb.andWhere('order.created_at >= :from', { from: fromDate });
    if (toDate) orderQb.andWhere('order.created_at <= :to', { to: toDate });
    const totalOrders = await orderQb.getCount();

    const statusQb = this.orderRepo
      .createQueryBuilder('order')
      .select('order.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('order.status');
    if (fromDate)
      statusQb.andWhere('order.created_at >= :from', { from: fromDate });
    if (toDate) statusQb.andWhere('order.created_at <= :to', { to: toDate });
    const statusRaw = await statusQb.getRawMany<{
      status: string;
      count: string;
    }>();

    // Doanh thu: giao dịch success, lọc paid_at (be/ dòng 45–51)
    const totalRevenue = await this.paymentCore.sumRevenue(fromDate, toDate);

    const [productsRes, usersRes] = await remote;
    const products = settledOrNull(productsRes);
    const users = settledOrNull(usersRes);
    const unavailable: OverviewStats['unavailable'] = [];
    if (!products) unavailable.push('catalog');
    if (!users) unavailable.push('identity');

    return {
      total_orders: totalOrders,
      total_revenue: totalRevenue,
      total_products: products?.total_products ?? null,
      active_products: products?.active_products ?? null,
      total_users: users?.total_users ?? null,
      orders_by_status: statusRaw.map((r) => ({
        status: r.status,
        count: Number(r.count),
      })),
      unavailable,
    };
  }
}
