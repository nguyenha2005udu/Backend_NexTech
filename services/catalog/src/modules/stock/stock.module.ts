import { Module } from '@nestjs/common';
import { StockReservationService } from './stock-reservation.service';

// Giữ kho / nhả kho (BR-01). Chỉ dùng qua API nội bộ (internal/stock.internal.controller.ts).
@Module({
  providers: [StockReservationService],
  exports: [StockReservationService],
})
export class StockModule {}
