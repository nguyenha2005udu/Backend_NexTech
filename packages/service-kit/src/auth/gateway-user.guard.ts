import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { hasValidInternalToken, unauthorized } from './internal-token.guard';

// Cùng shape với JwtPayload của monolith, để @CurrentUser() và user.sub không phải sửa
export interface GatewayUser {
  sub: string;
  email: string;
  role: string;
}

// Đọc X-User-* do gateway gắn. Trả undefined khi thiếu id hoặc vai trò.
export function userFromHeaders(req: Request): GatewayUser | undefined {
  const sub = req.headers['x-user-id'];
  const role = req.headers['x-user-role'];
  const email = req.headers['x-user-email'];
  if (typeof sub !== 'string' || !sub || typeof role !== 'string' || !role) {
    return undefined;
  }
  return { sub, email: typeof email === 'string' ? email : '', role };
}

// Thay JwtAccessGuard của monolith: gateway đã xác thực JWT (source-of-truth §2).
@Injectable()
export class GatewayUserGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx
      .switchToHttp()
      .getRequest<Request & { user?: GatewayUser }>();
    const user = hasValidInternalToken(req) ? userFromHeaders(req) : undefined;
    if (!user) throw unauthorized();
    req.user = user;
    return true;
  }
}
