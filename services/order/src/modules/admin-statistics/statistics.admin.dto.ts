// Chép từ be/src/admin/statistics/statistics.admin.dto.ts, phần QueryOverviewStatsDto (NT.ORDER route 12).
// QueryRevenueStatsDto ở admin-revenue (T3.6).
import { IsDateString, IsOptional } from 'class-validator';

// GET /api/admin/statistics/overview
export class QueryOverviewStatsDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
