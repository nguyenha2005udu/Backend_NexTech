// GET /api/admin/statistics/overview — chép từ be/src/admin/statistics/statistics.admin.controller.ts getOverview.
// Đổi guard như mọi route admin. /revenue ở admin-revenue (T3.6), cùng tiền tố đường dẫn.
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { GatewayUserGuard, Roles, RolesGuard } from '@nextech/service-kit';
import { QueryOverviewStatsDto } from './statistics.admin.dto';
import { AdminStatisticsService } from './statistics.admin.service';

@Controller('admin/statistics')
@UseGuards(GatewayUserGuard, RolesGuard)
@Roles('admin')
export class AdminStatisticsController {
  constructor(
    private readonly adminStatisticsService: AdminStatisticsService,
  ) {}

  // GET /api/admin/statistics/overview?from=&to=
  @Get('overview')
  getOverview(@Query() query: QueryOverviewStatsDto) {
    return this.adminStatisticsService.getOverview(query);
  }
}
