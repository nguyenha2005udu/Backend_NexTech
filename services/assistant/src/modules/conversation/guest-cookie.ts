import { isUUID } from 'class-validator';
import type { CookieOptions, Request, Response } from 'express';

// Cookie nhận diện THIẾT BỊ của khách (NT.ASSISTANT_CONVERSATION API_Spec §3, Component_Class_Design §4).
// Tách từ conversation.controller.ts của source cũ. Khác source cũ: giá trị không phải UUID coi như không có
// (source cũ đưa thẳng vào truy vấn, thành lỗi), `secure` theo COOKIE_SECURE thay vì NODE_ENV.
const NAME = 'guest_id';

const options = (): CookieOptions => ({
  httpOnly: true,
  secure: process.env.COOKIE_SECURE === 'true',
  sameSite: 'lax',
  maxAge: 365 * 24 * 60 * 60 * 1000,
});

export function readGuestId(req: Request): string | null {
  const value = (req.cookies as Record<string, unknown> | undefined)?.[NAME];
  return typeof value === 'string' && isUUID(value) ? value : null;
}

export function issueGuestCookie(res: Response, value: string): void {
  res.cookie(NAME, value, options());
}

// clearCookie phải dùng cùng tuỳ chọn thì trình duyệt mới xoá được (bỏ maxAge: express cảnh báo)
export function clearGuestCookie(res: Response): void {
  const opts = options();
  delete opts.maxAge;
  res.clearCookie(NAME, opts);
}
