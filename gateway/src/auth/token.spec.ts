import jwt from 'jsonwebtoken';
import type { Request } from 'express';
import { readAccessToken, verifyAccessToken } from './token';

const SECRET = 'test-secret';
const user = { sub: 'u1', email: 'a@b.c', role: 'user' };

describe('verifyAccessToken', () => {
  it('token hợp lệ → valid, payload có sub, email, role', () => {
    const t = jwt.sign(user, SECRET, { expiresIn: 60 });
    expect(verifyAccessToken(t, SECRET)).toEqual({
      kind: 'valid',
      payload: user,
    });
  });

  it('token hết hạn → expired', () => {
    const t = jwt.sign(user, SECRET, { expiresIn: -10 });
    expect(verifyAccessToken(t, SECRET)).toEqual({ kind: 'expired' });
  });

  it('sai chữ ký → invalid, kể cả khi đã hết hạn', () => {
    const t = jwt.sign(user, 'khoa-khac', { expiresIn: -10 });
    expect(verifyAccessToken(t, SECRET)).toEqual({ kind: 'invalid' });
  });

  it('chuỗi rác → invalid', () => {
    expect(verifyAccessToken('abc.def', SECRET)).toEqual({ kind: 'invalid' });
  });

  it('thiếu sub hoặc role → invalid', () => {
    const t = jwt.sign({ email: 'a@b.c' }, SECRET, { expiresIn: 60 });
    expect(verifyAccessToken(t, SECRET)).toEqual({ kind: 'invalid' });
  });
});

describe('readAccessToken', () => {
  const req = (cookies: Record<string, string>, auth?: string) =>
    ({
      cookies,
      headers: auth ? { authorization: auth } : {},
    }) as unknown as Request;

  it('ưu tiên cookie access_token', () => {
    expect(readAccessToken(req({ access_token: 'c' }, 'Bearer b'))).toBe('c');
  });

  it('không có cookie thì lấy Authorization: Bearer', () => {
    expect(readAccessToken(req({}, 'Bearer b'))).toBe('b');
  });

  it('không có gì → undefined', () => {
    expect(readAccessToken(req({}))).toBeUndefined();
    expect(readAccessToken(req({}, 'Basic x'))).toBeUndefined();
  });
});
