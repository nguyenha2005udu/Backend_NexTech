// Chép nguyên getRevenueStats từ be/src/admin/statistics/statistics.admin.service.ts (dòng 76–107): doanh thu
// tính theo payments success, nhóm theo tuần/tháng của paid_at. Chuyển sang order vì payments ở order_db
// (NT.PAYMENT route 7, ADR-0014). Một truy vấn. truncUnit chỉ nhận 'week' | 'month' (DTO), nên nối vào SQL an toàn.
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Payment } from '../../database/entities/payment.entity';
import { QueryRevenueStatsDto } from './revenue.admin.dto';

@Injectable()
export class RevenueService {
  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
  ) {}

  // GET /api/admin/statistics/revenue?groupBy=month|week&from=&to=
  async getRevenueStats(query: QueryRevenueStatsDto) {
    const { groupBy = 'month', from, to } = query;

    const truncUnit = groupBy === 'week' ? 'week' : 'month';

    const qb = this.paymentRepo
      .createQueryBuilder('payment')
      .select(
        `TO_CHAR(DATE_TRUNC('${truncUnit}', payment.paid_at), 'YYYY-MM-DD')`,
        'period',
      )
      .addSelect('COALESCE(SUM(payment.amount), 0)', 'revenue')
      .addSelect('COUNT(*)', 'order_count')
      .where('payment.status = :status', { status: 'success' })
      .andWhere('payment.paid_at IS NOT NULL')
      .groupBy(`DATE_TRUNC('${truncUnit}', payment.paid_at)`)
      .orderBy(`DATE_TRUNC('${truncUnit}', payment.paid_at)`, 'ASC');

    if (from) qb.andWhere('payment.paid_at >= :from', { from: new Date(from) });
    if (to) qb.andWhere('payment.paid_at <= :to', { to: new Date(to) });

    const raw = await qb.getRawMany<{
      period: string;
      revenue: string;
      order_count: string;
    }>();

    return {
      group_by: groupBy,
      items: raw.map((r) => ({
        period: r.period,
        revenue: Number(r.revenue),
        order_count: Number(r.order_count),
      })),
    };
  }
}
