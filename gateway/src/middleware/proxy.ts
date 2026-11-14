import type { ClientRequest, IncomingMessage } from 'node:http';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import type { GatewayConfig } from '../config';
import { GW_ERROR, sendError } from '../errors';

// Chuyển tiếp tới service đích (NT.GATEWAY Component_Class_Design §4).
// Một proxy dùng `router`, mount ở gốc, nên đường dẫn đi nguyên vẹn (không bị Express cắt tiền tố).
// Gateway không retry: không biết lệnh có idempotent không (Processing_Flow §4).

const NOT_REACHED = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
]);

function sendProxyError(
  err: Error & { code?: string },
  req: Request,
  res: Response,
  timeoutMs: number,
): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  const elapsed = Date.now() - (req.proxyStartedAt ?? Date.now());
  const timedOut =
    err.code === 'ETIMEDOUT' ||
    err.code === 'ESOCKETTIMEDOUT' ||
    (err.code === 'ECONNRESET' && elapsed >= timeoutMs * 0.9);
  if (timedOut) return sendError(req, res, GW_ERROR.UPSTREAM_TIMEOUT);
  if (!NOT_REACHED.has(err.code ?? '')) {
    console.warn(
      `[gateway] ${req.requestId} lỗi proxy ${err.code ?? err.message}`,
    );
  }
  sendError(req, res, GW_ERROR.UPSTREAM_UNAVAILABLE);
}

function buildProxy(config: GatewayConfig, timeoutMs: number): RequestHandler {
  return createProxyMiddleware<Request, Response>({
    router: (req) => config.serviceUrls[req.gatewayRoute.target],
    changeOrigin: true,
    proxyTimeout: timeoutMs,
    on: {
      proxyReq(proxyReq: ClientRequest, req: Request) {
        proxyReq.setHeader('x-internal-token', config.internalToken);
        proxyReq.setHeader('x-request-id', req.requestId);
        if (req.user) {
          proxyReq.setHeader('x-user-id', req.user.sub);
          proxyReq.setHeader('x-user-email', req.user.email ?? '');
          proxyReq.setHeader('x-user-role', req.user.role);
        }
      },
      proxyRes(proxyRes: IncomingMessage, _req: Request, res: Response) {
        // Proxy ghi đè Set-Cookie bằng của service: nối cookie gateway đã gắn (refresh hộ) vào trước
        const mine = res.getHeader('set-cookie');
        const theirs = proxyRes.headers['set-cookie'];
        if (mine && theirs) {
          proxyRes.headers['set-cookie'] = [
            ...(Array.isArray(mine) ? mine : [String(mine)]),
            ...theirs,
          ];
        }
      },
      error(err, req, res) {
        sendProxyError(err, req, res as Response, timeoutMs);
      },
    },
  });
}

export function createProxy(config: GatewayConfig): RequestHandler {
  const defaultProxy = buildProxy(config, config.proxyTimeoutMs);
  const aiProxy = buildProxy(config, config.proxyTimeoutAiMs);
  return (req: Request, res: Response, next: NextFunction) => {
    req.proxyStartedAt = Date.now();
    return (req.gatewayRoute.ai ? aiProxy : defaultProxy)(req, res, next);
  };
}
