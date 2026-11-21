// Chép từ be/src/admin/payment/payment.admin.controller.ts. Đổi guard: JwtAccessGuard → GatewayUserGuard;
// RolesGuard, @Roles từ service-kit. Gateway đã chặn thô /api/admin/* (security-policy §4), service vẫn giữ.
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { GatewayUserGuard, Roles, RolesGuard } from '@nextech/service-kit';
import {
  ConfirmCodPaymentDto,
  QueryAdminPaymentDto,
} from './payment.admin.dto';
import { AdminPaymentService } from './payment.admin.service';

@Controller('admin/payments')
@UseGuards(GatewayUserGuard, RolesGuard)
@Roles('admin')
export class AdminPaymentController {
  constructor(private readonly adminPaymentService: AdminPaymentService) {}

  // GET /api/admin/payments
  @Get()
  findAll(@Query() query: QueryAdminPaymentDto) {
    return this.adminPaymentService.findAll(query);
  }

  // GET /api/admin/payments/:id
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.adminPaymentService.findOne(id);
  }

  // POST /api/admin/payments/:id/confirm-cod. Giữ @Body như be/: ValidationPipe (forbidNonWhitelisted) chặn
  // body có trường lạ bằng 400
  @Post(':id/confirm-cod')
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- chỉ để ValidationPipe kiểm body
  confirmCod(@Param('id') id: string, @Body() _dto: ConfirmCodPaymentDto) {
    return this.adminPaymentService.confirmCod(id);
  }
}
