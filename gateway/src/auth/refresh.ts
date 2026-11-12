import type { CookieOptions, Request, Response } from 'express';
import type { GatewayConfig } from '../config';
import type { GatewayUser } from './token';

export type RefreshResult =
  | { kind: 'ok'; payload: GatewayUser }
  | { kind: 'failed' }
  | { kind: 'unavailable' };

interface IdentityTokens {
  access_token: string;
  refresh_token: string;
  access_ttl_s: number;
  refresh_ttl_s: number;
  user: GatewayUser;
}

type Outcome =
  | { kind: 'ok'; tokens: IdentityTokens }
  | { kind: 'rejected' }
  | { kind: 'unavailable' };

const REFRESH_PATH = '/internal/auth/refresh';

function isTokens(b: unknown): b is IdentityTokens {
  const t = b as Partial<IdentityTokens> | undefined;
  return (
    typeof t?.access_token === 'string' &&
    typeof t.refresh_token === 'string' &&
    typeof t.access_ttl_s === 'number' &&
    typeof t.refresh_ttl_s === 'number' &&
    typeof t.user?.sub === 'string' &&
    typeof t.user.role === 'string'
  );
}

// Refresh hộ client qua identity (NT.GATEWAY API_Spec §5, ADR-0004).
// - Timeout HTTP_TIMEOUT_MS, không retry: refresh token đổi sau mỗi lần dùng.
// - Các request đồng thời cùng refresh token dùng chung một lời gọi.
// - 200: ghi 2 cookie mới. 401/403: xoá 2 cookie. Lỗi, timeout, 5xx: giữ cookie, trả unavailable.
export function createRefresher(config: GatewayConfig) {
  // Tuỳ chọn cookie chép từ be/src/users/auth/auth.cookies.ts; `secure` đọc COOKIE_SECURE
  const cookieOptions: CookieOptions = {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'lax',
  };
  const inFlight = new Map<string, Promise<Outcome>>();

  async function callIdentity(
    refreshToken: string,
    requestId: string,
  ): Promise<Outcome> {
    try {
      const res = await fetch(
        new URL(REFRESH_PATH, config.serviceUrls.identity),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Internal-Token': config.internalToken,
            'X-Request-ID': requestId,
          },
          body: JSON.stringify({ refresh_token: refreshToken }),
          signal: AbortSignal.timeout(config.httpTimeoutMs),
        },
      );
      if (res.status === 401 || res.status === 403) return { kind: 'rejected' };
      const body: unknown = res.ok ? await res.json() : undefined;
      if (res.ok && isTokens(body)) return { kind: 'ok', tokens: body };
      console.warn(
        `[gateway] ${requestId} refresh: identity trả ${res.status}`,
      );
      return { kind: 'unavailable' };
    } catch (err) {
      // Không log token
      console.warn(
        `[gateway] ${requestId} refresh: không gọi được identity (${(err as Error).name})`,
      );
      return { kind: 'unavailable' };
    }
  }

  function shared(refreshToken: string, requestId: string): Promise<Outcome> {
    let p = inFlight.get(refreshToken);
    if (!p) {
      p = callIdentity(refreshToken, requestId).finally(() =>
        inFlight.delete(refreshToken),
      );
      inFlight.set(refreshToken, p);
    }
    return p;
  }

  return async function tryRefresh(
    req: Request,
    res: Response,
  ): Promise<RefreshResult> {
    const refreshToken = (req.cookies as Record<string, string> | undefined)
      ?.refresh_token;
    if (!refreshToken) return { kind: 'failed' };

    const outcome = await shared(refreshToken, req.requestId);
    if (outcome.kind === 'unavailable') return outcome;
    if (outcome.kind === 'rejected') {
      // clearCookie phải dùng cùng tuỳ chọn lúc set thì trình duyệt mới xoá
      res.clearCookie('access_token', cookieOptions);
      res.clearCookie('refresh_token', cookieOptions);
      return { kind: 'failed' };
    }

    const t = outcome.tokens;
    res.cookie('access_token', t.access_token, {
      ...cookieOptions,
      maxAge: t.access_ttl_s * 1000,
    });
    res.cookie('refresh_token', t.refresh_token, {
      ...cookieOptions,
      maxAge: t.refresh_ttl_s * 1000,
    });
    return {
      kind: 'ok',
      payload: {
        sub: t.user.sub,
        email: t.user.email ?? '',
        role: t.user.role,
      },
    };
  };
}
