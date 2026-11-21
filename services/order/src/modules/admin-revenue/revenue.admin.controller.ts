// GET /api/admin/statistics/revenue — chép từ be/src/admin/statistics/statistics.admin.controller.ts getRevenue.
// Đổi guard như mọi route admin. /overview ở admin-statistics (T3.7), cùng tiền tố đường dẫn.
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { GatewayUserGuard, Roles, RolesGuard } from '@nextech/service-kit';
import { QueryRevenueStatsDto } from './revenue.admin.dto';
import { RevenueService } from './revenue.admin.service';

@Controller('admin/statistics')
@UseGuards(GatewayUserGuard, RolesGuard)
@Roles('admin')
export class AdminRevenueController {
  constructor(private readonly revenueService: RevenueService) {}

  // GET /api/admin/statistics/revenue?groupBy=month|week&from=&to=
  @Get('revenue')
  getRevenue(@Query() query: QueryRevenueStatsDto) {
    return this.revenueService.getRevenueStats(query);
  }
}
