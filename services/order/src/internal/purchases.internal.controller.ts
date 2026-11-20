import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { InternalTokenGuard } from '@nextech/service-kit';
import { PurchaseCheckQueryDto } from './purchases.internal.dto';
import { PurchasesInternalService } from './purchases.internal.service';

// API nội bộ, không qua gateway, bắt buộc X-Internal-Token (security-policy §3). Bên gọi: catalog.
@Controller('internal/purchases')
@UseGuards(InternalTokenGuard)
export class PurchasesInternalController {
  constructor(private readonly purchases: PurchasesInternalService) {}

  // GET /internal/purchases/check?user_id=&product_id=
  @Get('check')
  check(@Query() query: PurchaseCheckQueryDto) {
    return this.purchases.hasPurchased(query.user_id, query.product_id);
  }
}
