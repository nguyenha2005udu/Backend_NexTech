import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import {
  clearAuthCookies,
  parseExpiryToSeconds,
  setAuthCookies,
} from './auth.cookies';

function res() {
  return { cookie: jest.fn(), clearCookie: jest.fn() };
}

function config(cookieSecure: boolean) {
  return new ConfigService({
    cookieSecure,
    jwt: { accessExpiresIn: '15m', refreshExpiresIn: '7d' },
  });
}

describe('auth.cookies', () => {
  describe('parseExpiryToSeconds (giữ nguyên be/)', () => {
    it.each([
      ['15m', 900],
      ['7d', 604800],
      ['2h', 7200],
      ['3600', 3600],
      ['30s', 30],
    ])('%s → %d', (v, s) => expect(parseExpiryToSeconds(v, 1)).toBe(s));

    it('rỗng hoặc sai định dạng → fallback', () => {
      expect(parseExpiryToSeconds(undefined, 42)).toBe(42);
      expect(parseExpiryToSeconds('abc', 42)).toBe(42);
    });
  });

  it.each([true, false])(
    'setAuthCookies: secure = COOKIE_SECURE (%s)',
    (secure) => {
      const r = res();
      setAuthCookies(r as unknown as Response, config(secure), 'a', 'r');
      expect(r.cookie).toHaveBeenCalledWith('access_token', 'a', {
        httpOnly: true,
        secure,
        sameSite: 'lax',
        maxAge: 900_000,
      });
      expect(r.cookie).toHaveBeenCalledWith('refresh_token', 'r', {
        httpOnly: true,
        secure,
        sameSite: 'lax',
        maxAge: 604_800_000,
      });
    },
  );

  it('clearAuthCookies dùng cùng tuỳ chọn lúc set', () => {
    const r = res();
    clearAuthCookies(r as unknown as Response, config(true));
    const opts = { httpOnly: true, secure: true, sameSite: 'lax' };
    expect(r.clearCookie).toHaveBeenCalledWith('access_token', opts);
    expect(r.clearCookie).toHaveBeenCalledWith('refresh_token', opts);
  });
});
