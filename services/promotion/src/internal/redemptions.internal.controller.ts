import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { InternalTokenGuard } from '@nextech/service-kit';
import { RedeemDto } from '../modules/redemption/redeem.dto';
import { RedemptionService } from '../modules/redemption/redemption.service';

// API nội bộ cho order-service (NT.PROMOTION API_Spec §2). Không qua gateway, bắt buộc X-Internal-Token.
@Controller('internal/redemptions')
@UseGuards(InternalTokenGuard)
export class RedemptionsInternalController {
  constructor(private readonly redemptions: RedemptionService) {}

  // 201 khi vừa ghi nhận, 200 khi đã có (trả kết quả cũ)
  @Post()
  async redeem(
    @Body() dto: RedeemDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { created, redemption } = await this.redemptions.redeem(dto);
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return redemption;
  }

  @Get(':orderId')
  get(@Param('orderId', ParseUUIDPipe) orderId: string) {
    return this.redemptions.get(orderId);
  }

  // Luôn 200, idempotent
  @Delete(':orderId')
  release(@Param('orderId', ParseUUIDPipe) orderId: string) {
    return this.redemptions.release(orderId);
  }
}
