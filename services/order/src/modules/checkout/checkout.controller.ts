// POST /api/orders — chép từ be/src/users/order/order.controller.ts checkout. Đổi guard: JwtAccessGuard →
// GatewayUserGuard. Thêm header Idempotency-Key và 202 khi saga chưa rõ kết quả (NT.CHECKOUT_SAGA
// API_Spec §1). PUT /orders/:id/cancel thêm ở T3.5. GET /orders* ở modules/order.
import {
  Body,
  Controller,
  Headers,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  CurrentUser,
  GatewayUserGuard,
  type GatewayUser,
} from '@nextech/service-kit';
import type { Response } from 'express';
import { CreateOrderDto } from './checkout.dto';
import { CheckoutService } from './checkout.service';

@Controller('orders')
@UseGuards(GatewayUserGuard)
export class CheckoutController {
  constructor(private readonly checkoutService: CheckoutService) {}

  // POST /api/orders → 201 (đơn pending) hoặc 202 (đơn processing, hỏi lại GET /api/orders/:id)
  @Post()
  async checkout(
    @CurrentUser() user: GatewayUser,
    @Body() dto: CreateOrderDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.checkoutService.checkout(
      user.sub,
      dto,
      idempotencyKey,
    );
    res.status(r.status);
    return r.body;
  }
}
