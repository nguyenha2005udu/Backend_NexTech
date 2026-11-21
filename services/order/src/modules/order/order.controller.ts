// Chép GET từ be/src/users/order/order.controller.ts. Đổi guard: JwtAccessGuard → GatewayUserGuard.
// POST /orders (checkout, T3.3), PUT /orders/:id/cancel (T3.5): cùng đường dẫn, ở modules/checkout.
import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  CurrentUser,
  GatewayUserGuard,
  type GatewayUser,
} from '@nextech/service-kit';
import { QueryOrderDto } from './order.dto';
import { OrderService } from './order.service';

@Controller('orders')
@UseGuards(GatewayUserGuard)
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  // GET /api/orders
  @Get()
  findMine(@CurrentUser() user: GatewayUser, @Query() query: QueryOrderDto) {
    return this.orderService.findMine(user.sub, query);
  }

  // GET /api/orders/:id
  @Get(':id')
  findOneMine(@CurrentUser() user: GatewayUser, @Param('id') id: string) {
    return this.orderService.findOneMine(user.sub, id);
  }
}
