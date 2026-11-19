import { Controller, Get, UseGuards } from '@nestjs/common';
import { InternalTokenGuard } from '@nextech/service-kit';
import { ProductsInternalService } from './products.internal.service';

// Bên gọi: order-service, thống kê tổng quan (NT.ORDER Component_Class_Design `stats()`).
@Controller('internal/stats')
@UseGuards(InternalTokenGuard)
export class StatsInternalController {
  constructor(private readonly service: ProductsInternalService) {}

  @Get('products')
  products() {
    return this.service.stats();
  }
}
