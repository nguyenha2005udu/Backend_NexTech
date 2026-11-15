import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { InternalTokenGuard } from '@nextech/service-kit';
import { AuthService } from '../modules/auth/auth.service';
import { RefreshInternalDto } from './internal.dto';

// Gateway refresh hộ client (NT.IDENTITY API_Spec §2, NT.GATEWAY Processing_Flow §2).
// Không idempotent: gateway không retry. 401 / 403 → gateway xoá cookie; lỗi khác → gateway trả 503.
@Controller('internal/auth')
@UseGuards(InternalTokenGuard)
export class AuthInternalController {
  constructor(private readonly auth: AuthService) {}

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshInternalDto) {
    return this.auth.verifyAndRefresh(dto.refresh_token);
  }
}
