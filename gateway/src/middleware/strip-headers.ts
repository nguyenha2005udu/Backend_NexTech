import type { NextFunction, Request, Response } from 'express';

// Header chỉ gateway được gắn (security-policy §3.1). Client gửi thì xoá trước khi xử lý.
const TRUSTED_HEADERS = [
  'x-user-id',
  'x-user-email',
  'x-user-role',
  'x-internal-token',
];

export function stripClientHeaders(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  for (const h of TRUSTED_HEADERS) delete req.headers[h];
  next();
}
