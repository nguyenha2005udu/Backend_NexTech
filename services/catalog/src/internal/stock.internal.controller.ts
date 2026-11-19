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
import { ReserveStockDto } from '../modules/stock/stock-reservation.dto';
import { StockReservationService } from '../modules/stock/stock-reservation.service';

// Giữ / nhả kho cho saga của order-service (NT.CATALOG API_Spec §2). Không qua gateway, bắt buộc X-Internal-Token.
@Controller('internal/stock-reservations')
@UseGuards(InternalTokenGuard)
export class StockInternalController {
  constructor(private readonly stock: StockReservationService) {}

  // 201 khi vừa giữ, 200 khi đã giữ từ trước (không trừ thêm)
  @Post()
  async reserve(
    @Body() dto: ReserveStockDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { created, reservation } = await this.stock.reserve(
      dto.order_id,
      dto.items,
    );
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return reservation;
  }

  @Get(':orderId')
  get(@Param('orderId', ParseUUIDPipe) orderId: string) {
    return this.stock.get(orderId);
  }

  // Luôn 200, idempotent
  @Delete(':orderId')
  release(@Param('orderId', ParseUUIDPipe) orderId: string) {
    return this.stock.release(orderId);
  }
}
