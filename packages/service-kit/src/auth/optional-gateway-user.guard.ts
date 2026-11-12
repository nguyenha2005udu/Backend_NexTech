import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { GatewayUser, userFromHeaders } from './gateway-user.guard';
import { hasValidInternalToken, unauthorized } from './internal-token.guard';

// Thay OptionalJwtAccessGuard: route cho cả khách lẫn người đã đăng nhập.
// Có X-User-* thì dựng req.user, không có thì để trống (khách). Token nội bộ vẫn bắt buộc.
@Injectable()
export class OptionalGatewayUserGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx
      .switchToHttp()
      .getRequest<Request & { user?: GatewayUser }>();
    if (!hasValidInternalToken(req)) throw unauthorized();
    req.user = userFromHeaders(req);
    return true;
  }
}
