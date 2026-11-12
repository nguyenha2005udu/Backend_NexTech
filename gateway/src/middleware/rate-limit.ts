import type { Request, RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { GatewayConfig } from '../config';
import { GW_ERROR, sendError } from '../errors';

// Rate limit theo IP (NT.GATEWAY API_Spec §3). Giá trị 0 = tắt, để đo tải.
// Vượt thì 429 NT-GW-0429.

// Route đăng nhập: login, send-otp, forgot-password, verify-*
const AUTH_PATH =
  /^\/api\/auth\/(login|send-otp|forgot-password|verify-[^/]+)\/?$/;

function limiter(
  perMin: number,
  applies: (req: Request) => boolean,
): RequestHandler {
  if (perMin <= 0) return (_req, _res, next) => next();
  return rateLimit({
    windowMs: 60_000,
    limit: perMin,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: (req) => !applies(req),
    handler: (req, res) => sendError(req, res, GW_ERROR.RATE_LIMITED),
  });
}

export function createRateLimits(config: GatewayConfig) {
  return {
    /** Tổng, đặt trước tra route */
    general: limiter(config.rateLimitPerMin, () => true),
    /** Sau tra route */
    auth: limiter(config.rateLimitAuthPerMin, (req) =>
      AUTH_PATH.test(req.path),
    ),
    /** Sau tra route, chỉ route `ai` (dòng 23, 26) */
    ai: limiter(
      config.rateLimitAiPerMin,
      (req) => req.gatewayRoute?.ai === true,
    ),
  };
}
