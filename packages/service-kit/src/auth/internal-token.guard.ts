import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { BusinessException } from '../errors/business.exception';
import { GEN_ERROR } from '../errors/codes';

export function unauthorized(): BusinessException {
  return new BusinessException(
    HttpStatus.UNAUTHORIZED,
    GEN_ERROR.UNAUTHORIZED,
    'Thiếu thông tin người dùng hoặc token nội bộ',
  );
}

// So token bằng timingSafeEqual (security-policy §3.4). Service chưa cấu hình token thì từ chối tất cả.
export function hasValidInternalToken(req: Request): boolean {
  const expected = process.env.INTERNAL_API_TOKEN ?? '';
  const received = req.headers['x-internal-token'];
  if (!expected || typeof received !== 'string') return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Bảo vệ controller /internal/*
@Injectable()
export class InternalTokenGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    if (!hasValidInternalToken(ctx.switchToHttp().getRequest<Request>())) {
      throw unauthorized();
    }
    return true;
  }
}
