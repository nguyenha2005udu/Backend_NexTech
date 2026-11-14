import jwt from 'jsonwebtoken';
import type { Request } from 'express';

// Cùng shape với JwtPayload của be/src/users/auth/jwt.strategy.ts
export interface GatewayUser {
  sub: string;
  email: string;
  role: string;
}

export type VerifyResult =
  | { kind: 'valid'; payload: GatewayUser }
  | { kind: 'expired' }
  | { kind: 'invalid' };

// Phân biệt hết hạn (được refresh hộ) với sai chữ ký (không refresh) — API_Spec §5.
// jsonwebtoken kiểm chữ ký trước hạn, nên token sai chữ ký đã hết hạn vẫn là invalid.
export function verifyAccessToken(token: string, secret: string): VerifyResult {
  try {
    const p = jwt.verify(token, secret, { algorithms: ['HS256'] });
    if (
      typeof p !== 'object' ||
      typeof p.sub !== 'string' ||
      typeof p.role !== 'string'
    ) {
      return { kind: 'invalid' };
    }
    const email = typeof p.email === 'string' ? p.email : '';
    return { kind: 'valid', payload: { sub: p.sub, email, role: p.role } };
  } catch (err) {
    return err instanceof jwt.TokenExpiredError
      ? { kind: 'expired' }
      : { kind: 'invalid' };
  }
}

// Cookie access_token trước (như be/), sau đó Authorization: Bearer (security-policy §2)
export function readAccessToken(req: Request): string | undefined {
  const cookie = (req.cookies as Record<string, string> | undefined)
    ?.access_token;
  if (cookie) return cookie;
  const auth = req.headers.authorization;
  return auth?.startsWith('Bearer ')
    ? auth.slice(7).trim() || undefined
    : undefined;
}
