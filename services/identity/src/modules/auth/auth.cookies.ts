import { ConfigService } from '@nestjs/config';
import { CookieOptions, Response } from 'express';

// Chép từ be/src/users/auth/auth.cookies.ts. Đổi duy nhất: `secure` đọc COOKIE_SECURE (config `cookieSecure`)
// thay cho `NODE_ENV === 'production'` — chạy HTTP local mà bật secure thì cookie không gửi được.
function cookieOptions(config: ConfigService): CookieOptions {
  return {
    httpOnly: true,
    secure: config.get<boolean>('cookieSecure') === true,
    sameSite: 'lax',
  };
}

export const DEFAULT_ACCESS_TTL_SECONDS = 15 * 60;
export const DEFAULT_REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60;

// "15m" / "7d" / "3600" -> số giây. Không parse được -> fallback.
export function parseExpiryToSeconds(
  value: string | undefined,
  fallbackSeconds: number,
): number {
  if (!value) return fallbackSeconds;
  const match = /^(\d+)([smhd])?$/.exec(value);
  if (!match) return fallbackSeconds;
  const num = Number(match[1]);
  switch (match[2]) {
    case 'm':
      return num * 60;
    case 'h':
      return num * 3600;
    case 'd':
      return num * 86400;
    default:
      return num;
  }
}

// TTL access/refresh theo JWT_EXPIRES_IN, JWT_REFRESH_EXPIRES_IN — dùng cho cookie và API nội bộ refresh
export function tokenTtls(config: ConfigService) {
  return {
    accessTtl: parseExpiryToSeconds(
      config.get<string>('jwt.accessExpiresIn'),
      DEFAULT_ACCESS_TTL_SECONDS,
    ),
    refreshTtl: parseExpiryToSeconds(
      config.get<string>('jwt.refreshExpiresIn'),
      DEFAULT_REFRESH_TTL_SECONDS,
    ),
  };
}

export function setAuthCookies(
  res: Response,
  config: ConfigService,
  accessToken: string,
  refreshToken: string,
) {
  const { accessTtl, refreshTtl } = tokenTtls(config);
  const opts = cookieOptions(config);
  res.cookie('access_token', accessToken, {
    ...opts,
    maxAge: accessTtl * 1000,
  });
  res.cookie('refresh_token', refreshToken, {
    ...opts,
    maxAge: refreshTtl * 1000,
  });
}

// clearCookie phải truyền cùng option lúc set thì trình duyệt mới xoá được
export function clearAuthCookies(res: Response, config: ConfigService) {
  const opts = cookieOptions(config);
  res.clearCookie('access_token', opts);
  res.clearCookie('refresh_token', opts);
}
