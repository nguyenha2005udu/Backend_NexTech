import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const HEADER = 'X-Request-ID';
const MAX_LEN = 128;

// Giữ X-Request-ID của client nếu hợp lệ, không thì sinh mới; trả lại trong response.
export function requestId(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const incoming = req.headers['x-request-id'];
  req.requestId =
    typeof incoming === 'string' &&
    incoming.trim() !== '' &&
    incoming.length <= MAX_LEN
      ? incoming
      : randomUUID();
  res.setHeader(HEADER, req.requestId);
  next();
}
