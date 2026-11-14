import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';

// Chép từ be/src/users/auth/auth.guard.ts. Chỉ giữ JwtRefreshGuard, GoogleAuthGuard, FacebookAuthGuard.
// Bỏ JwtAccessGuard, OptionalJwtAccessGuard, trySilentRefresh (gateway xác thực và refresh hộ),
// RolesGuard (dùng từ @nextech/service-kit) — NT.IDENTITY Component_Class_Design §2.

@Injectable()
export class JwtRefreshGuard extends AuthGuard('jwt-refresh') {}

// App mobile gọi GET /auth/google?platform=mobile — đưa cờ đó vào `state` để nó đi
// xuyên qua vòng OAuth và quay lại callback (req.query.state), nơi controller quyết
// định redirect về web hay về deep link của app.
function oauthStateFromQuery(context: ExecutionContext) {
  const request = context.switchToHttp().getRequest<Request>();
  return request.query.platform === 'mobile' ? { state: 'mobile' } : undefined;
}

@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  getAuthenticateOptions(context: ExecutionContext) {
    return oauthStateFromQuery(context);
  }
}

@Injectable()
export class FacebookAuthGuard extends AuthGuard('facebook') {
  constructor() {
    super({ scope: ['email'] });
  }

  getAuthenticateOptions(context: ExecutionContext) {
    return oauthStateFromQuery(context);
  }
}
