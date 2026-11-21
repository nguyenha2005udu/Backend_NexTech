// Chép từ be/src/admin/statistics/statistics.admin.dto.ts, phần QueryRevenueStatsDto (NT.PAYMENT route 7).
// QueryOverviewStatsDto ở admin-statistics (T3.7).
import { IsDateString, IsIn, IsOptional } from 'class-validator';

// GET /api/admin/statistics/revenue
export class QueryRevenueStatsDto {
  @IsOptional()
  @IsIn(['week', 'month'])
  groupBy?: 'week' | 'month' = 'month';

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
