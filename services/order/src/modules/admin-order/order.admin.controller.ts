// Chép từ be/src/admin/order/order.admin.controller.ts. Đổi guard: JwtAccessGuard → GatewayUserGuard;
// RolesGuard, @Roles từ service-kit. Gateway đã chặn thô /api/admin/* (security-policy §4), service vẫn giữ.
import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { GatewayUserGuard, Roles, RolesGuard } from '@nextech/service-kit';
import { QueryAdminOrderDto, UpdateOrderStatusDto } from './order.admin.dto';
import { AdminOrderService } from './order.admin.service';

@Controller('admin/orders')
@UseGuards(GatewayUserGuard, RolesGuard)
@Roles('admin')
export class AdminOrderController {
  constructor(private readonly adminOrderService: AdminOrderService) {}

  // GET /api/admin/orders
  @Get()
  findAll(@Query() query: QueryAdminOrderDto) {
    return this.adminOrderService.findAll(query);
  }

  // GET /api/admin/orders/:id
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.adminOrderService.findOne(id);
  }

  // PUT /api/admin/orders/:id/status
  @Put(':id/status')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateOrderStatusDto) {
    return this.adminOrderService.updateStatus(id, dto);
  }
}
