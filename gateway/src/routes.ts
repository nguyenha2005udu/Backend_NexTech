import type { ServiceName } from './config';

// Bảng định tuyến (NT.GATEWAY API_Spec §2). Xét từ trên xuống, dòng đầu khớp thì dùng.
// Dữ liệu, không phải code: thêm route chỉ sửa ở đây.

export type Access = 'public' | 'optional' | 'user' | 'admin';

export interface Route {
  method?: string;
  pattern: RegExp;
  target: ServiceName;
  access: Access;
  /** Dùng timeout và rate limit AI (ADR-0012) */
  ai?: boolean;
}

const esc = (p: string) => p.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
/** `/api/x*` trong bảng: chính nó và mọi đường dẫn con */
const under = (p: string) => new RegExp(`^${esc(p)}(\\/|$)`);
/** Đường dẫn đúng như khai, `:id` là một đoạn */
const exact = (p: string) =>
  new RegExp(`^${esc(p).replace(/:[a-z]+/gi, '[^/]+')}\\/?$`);

export const routes: Route[] = [
  {
    method: 'GET',
    pattern: exact('/api/auth/me'),
    target: 'identity',
    access: 'user',
  }, // 1
  { pattern: under('/api/auth'), target: 'identity', access: 'public' }, // 2
  { pattern: under('/api/users/me'), target: 'identity', access: 'user' }, // 3
  { pattern: under('/api/admin/users'), target: 'identity', access: 'admin' }, // 4
  {
    method: 'POST',
    pattern: exact('/api/products/:id/reviews'),
    target: 'catalog',
    access: 'user',
  }, // 5
  { pattern: under('/api/products'), target: 'catalog', access: 'public' }, // 6
  { pattern: under('/api/categories'), target: 'catalog', access: 'public' }, // 7
  { pattern: under('/api/industries'), target: 'catalog', access: 'public' }, // 8
  { pattern: under('/api/price-alerts'), target: 'catalog', access: 'user' }, // 9
  { pattern: under('/api/admin/products'), target: 'catalog', access: 'admin' }, // 10
  {
    pattern: under('/api/admin/categories'),
    target: 'catalog',
    access: 'admin',
  }, // 11
  {
    pattern: under('/api/discount-codes'),
    target: 'promotion',
    access: 'public',
  }, // 12
  {
    pattern: under('/api/admin/discount-codes'),
    target: 'promotion',
    access: 'admin',
  }, // 13
  { pattern: under('/api/cart'), target: 'order', access: 'user' }, // 14
  { pattern: under('/api/orders'), target: 'order', access: 'user' }, // 15
  { pattern: under('/api/admin/orders'), target: 'order', access: 'admin' }, // 16
  {
    method: 'GET',
    pattern: exact('/api/admin/statistics/overview'),
    target: 'order',
    access: 'admin',
  }, // 17
  {
    method: 'GET',
    pattern: exact('/api/admin/statistics/revenue'),
    target: 'order',
    access: 'admin',
  }, // 18
  { pattern: under('/api/payments'), target: 'order', access: 'user' }, // 19
  { pattern: under('/api/admin/payments'), target: 'order', access: 'admin' }, // 20
  {
    method: 'POST',
    pattern: exact('/api/webhooks/payos'),
    target: 'order',
    access: 'public',
  }, // 21
  {
    pattern: under('/api/notifications'),
    target: 'notification',
    access: 'user',
  }, // 22
  {
    method: 'POST',
    pattern: exact('/api/chat'),
    target: 'assistant',
    access: 'public',
    ai: true,
  }, // 23
  {
    method: 'GET',
    pattern: exact('/api/conversations'),
    target: 'assistant',
    access: 'user',
  }, // 24
  {
    method: 'POST',
    pattern: exact('/api/conversations/claim'),
    target: 'assistant',
    access: 'user',
  }, // 25
  {
    method: 'POST',
    pattern: exact('/api/conversations/:id/messages'),
    target: 'assistant',
    access: 'optional',
    ai: true,
  }, // 26
  {
    pattern: under('/api/conversations'),
    target: 'assistant',
    access: 'optional',
  }, // 27
  {
    pattern: under('/api/admin/conversations'),
    target: 'assistant',
    access: 'admin',
  }, // 28
  { pattern: under('/api/places'), target: 'identity', access: 'user' }, // 29
];

export function matchRoute(method: string, url: string): Route | undefined {
  const path = url.split('?')[0];
  return routes.find(
    (r) => (!r.method || r.method === method) && r.pattern.test(path),
  );
}
