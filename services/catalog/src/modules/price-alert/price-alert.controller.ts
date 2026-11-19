// Chép từ be/src/users/pricealert/pricealert.controller.ts. Đổi guard: JwtAccessGuard → GatewayUserGuard
// (gateway đã xác thực JWT, dòng 9 routes.ts mức `user`); `user.sub` giữ nguyên shape.
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  CurrentUser,
  GatewayUserGuard,
  type GatewayUser,
} from '@nextech/service-kit';
import { CreatePriceAlertDto } from './price-alert.dto';
import { PriceAlertService } from './price-alert.service';

@Controller('price-alerts')
@UseGuards(GatewayUserGuard)
export class PriceAlertController {
  constructor(private readonly priceAlertService: PriceAlertService) {}

  // GET /api/price-alerts
  @Get()
  findMine(@CurrentUser() user: GatewayUser) {
    return this.priceAlertService.findMine(user.sub);
  }

  // POST /api/price-alerts
  @Post()
  create(@CurrentUser() user: GatewayUser, @Body() dto: CreatePriceAlertDto) {
    return this.priceAlertService.create(user.sub, dto);
  }

  // DELETE /api/price-alerts/:id — như be/, không ParseUUIDPipe
  @Delete(':id')
  remove(@CurrentUser() user: GatewayUser, @Param('id') id: string) {
    return this.priceAlertService.remove(user.sub, id);
  }
}
