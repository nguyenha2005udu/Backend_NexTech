import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy as JwtStrategyBase, ExtractJwt } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import type { JwtPayload } from './auth.service';

// Chép từ be/src/users/auth/jwt.strategy.ts, chỉ giữ JwtRefreshStrategy (cho POST /api/auth/refresh).
// Bỏ JwtAccessStrategy: access token do gateway xác thực (NT.IDENTITY Component_Class_Design §2).
@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(
  JwtStrategyBase,
  'jwt-refresh',
) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: Request) =>
          (req?.cookies as Record<string, string> | undefined)?.refresh_token ||
          null,
      ]),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('jwt.refreshSecret') as string,
      passReqToCallback: true,
    });
  }

  validate(req: Request, payload: JwtPayload) {
    const refreshToken = (req.cookies as Record<string, string> | undefined)
      ?.refresh_token;
    return { ...payload, refreshToken };
  }
}
