import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { GatewayConfig } from '../config';
import { GW_ERROR, sendError } from '../errors';
import { createRefresher } from '../auth/refresh';
import { readAccessToken, verifyAccessToken } from '../auth/token';

// Xác thực theo mức truy cập của route (NT.GATEWAY Component_Class_Design §5, ADR-0004, ADR-0012).
//  public   : không gắn user
//  user     : token hợp lệ; thiếu hoặc hết hạn thì refresh hộ
//  admin    : như user, thêm role === 'admin'
//  optional : như user, nhưng sai chữ ký hoặc refresh bị từ chối thì đi tiếp như khách
export function createAuthenticate(config: GatewayConfig): RequestHandler {
  const tryRefresh = createRefresher(config);

  return async (req: Request, res: Response, next: NextFunction) => {
    const { access } = req.gatewayRoute;
    if (access === 'public') return next();

    const token = readAccessToken(req);
    const result = token
      ? verifyAccessToken(token, config.jwtSecret)
      : { kind: 'missing' as const };

    if (result.kind === 'valid') {
      req.user = result.payload;
    } else if (result.kind === 'invalid') {
      // Sai chữ ký: không refresh
      if (access !== 'optional')
        return sendError(req, res, GW_ERROR.UNAUTHORIZED);
    } else {
      // Thiếu hoặc hết hạn
      const refreshed = await tryRefresh(req, res);
      if (refreshed.kind === 'unavailable') {
        // Cả mức optional: người đã đăng nhập không bị coi nhầm là khách
        return sendError(req, res, GW_ERROR.UPSTREAM_UNAVAILABLE);
      }
      if (refreshed.kind === 'failed') {
        if (access !== 'optional')
          return sendError(req, res, GW_ERROR.UNAUTHORIZED);
      } else {
        req.user = refreshed.payload;
      }
    }

    if (access === 'admin' && req.user?.role !== 'admin') {
      return sendError(req, res, GW_ERROR.FORBIDDEN);
    }
    next();
  };
}
