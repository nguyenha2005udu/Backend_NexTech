// Chép từ be/src/users/payment/payment.controller.ts. Đổi guard: JwtAccessGuard → GatewayUserGuard (tin X-User-*
// từ gateway), req.user.sub → @CurrentUser().
import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import {
  CurrentUser,
  GatewayUserGuard,
  type GatewayUser,
} from '@nextech/service-kit';
import { CreatePaymentDto } from './payment.dto';
import { PaymentService } from './payment.service';

@Controller('payments')
@UseGuards(GatewayUserGuard)
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  // POST /api/payments
  @Post()
  create(@Body() dto: CreatePaymentDto, @CurrentUser() user: GatewayUser) {
    return this.paymentService.create(user.sub, dto);
  }

  // GET /api/payments/:id/status
  @Get(':id/status')
  getStatus(@Param('id') id: string, @CurrentUser() user: GatewayUser) {
    return this.paymentService.getStatus(user.sub, id);
  }
}
