import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { InternalTokenGuard } from '@nextech/service-kit';
import { ProductsBatchDto } from './products.internal.dto';
import { ProductsInternalService } from './products.internal.service';

// API nội bộ, không qua gateway, bắt buộc X-Internal-Token (security-policy §3).
@Controller('internal/products')
@UseGuards(InternalTokenGuard)
export class ProductsInternalController {
  constructor(private readonly products: ProductsInternalService) {}

  // Đọc, không tạo gì → 200
  @Post('batch')
  @HttpCode(HttpStatus.OK)
  batch(@Body() dto: ProductsBatchDto) {
    return this.products.findBatch(dto.ids);
  }
}
