import { matchRoute, routes } from './routes';

// [method, path, target, access, ai?] — mỗi dòng của API_Spec §2 có ít nhất một ca
const CASES: [string, string, string, string, boolean?][] = [
  ['GET', '/api/auth/me', 'identity', 'user'], // 1
  ['POST', '/api/auth/login', 'identity', 'public'], // 2
  ['PUT', '/api/auth/me', 'identity', 'public'], // 2: chỉ GET /auth/me là user
  ['GET', '/api/users/me', 'identity', 'user'], // 3
  ['PATCH', '/api/users/me/addresses/1', 'identity', 'user'], // 3
  ['GET', '/api/admin/users', 'identity', 'admin'], // 4
  ['PATCH', '/api/admin/users/u1/lock', 'identity', 'admin'], // 4
  ['POST', '/api/products/p1/reviews', 'catalog', 'user'], // 5
  ['GET', '/api/products/p1/reviews', 'catalog', 'public'], // 6
  ['GET', '/api/products', 'catalog', 'public'], // 6
  ['GET', '/api/categories/c1', 'catalog', 'public'], // 7
  ['GET', '/api/industries', 'catalog', 'public'], // 8
  ['POST', '/api/price-alerts', 'catalog', 'user'], // 9
  ['POST', '/api/admin/products', 'catalog', 'admin'], // 10
  ['DELETE', '/api/admin/categories/c1', 'catalog', 'admin'], // 11
  ['POST', '/api/discount-codes/apply', 'promotion', 'public'], // 12
  ['GET', '/api/admin/discount-codes', 'promotion', 'admin'], // 13
  ['POST', '/api/cart/items', 'order', 'user'], // 14
  ['POST', '/api/orders', 'order', 'user'], // 15
  ['PUT', '/api/orders/o1/cancel', 'order', 'user'], // 15
  ['PATCH', '/api/admin/orders/o1/status', 'order', 'admin'], // 16
  ['GET', '/api/admin/statistics/overview', 'order', 'admin'], // 17
  ['GET', '/api/admin/statistics/revenue', 'order', 'admin'], // 18
  ['POST', '/api/payments', 'order', 'user'], // 19
  ['POST', '/api/admin/payments/x/confirm-cod', 'order', 'admin'], // 20
  ['POST', '/api/webhooks/payos', 'order', 'public'], // 21
  ['GET', '/api/notifications', 'notification', 'user'], // 22
  ['POST', '/api/chat', 'assistant', 'public', true], // 23
  ['GET', '/api/conversations', 'assistant', 'user'], // 24
  ['POST', '/api/conversations/claim', 'assistant', 'user'], // 25
  ['POST', '/api/conversations/c1/messages', 'assistant', 'optional', true], // 26
  ['POST', '/api/conversations', 'assistant', 'optional'], // 27
  ['GET', '/api/conversations/c1/messages', 'assistant', 'optional'], // 27
  ['GET', '/api/admin/conversations/c1', 'assistant', 'admin'], // 28
  ['GET', '/api/places/provinces', 'identity', 'user'], // 29
];

describe('routes', () => {
  it('có đủ 29 dòng của API_Spec §2', () => {
    expect(routes).toHaveLength(29);
  });

  // `ai = false`: tham số có mặc định không tính vào arity, để jest không truyền `done` vào đây
  it.each(CASES)(
    '%s %s → %s / %s',
    (method, path, target, access, ai = false) => {
      const r = matchRoute(method, path);
      expect(r).toMatchObject({ target, access });
      expect(Boolean(r?.ai)).toBe(ai);
    },
  );

  it('bỏ query string khi so khớp', () => {
    expect(matchRoute('GET', '/api/products?page=2&q=a')).toMatchObject({
      target: 'catalog',
    });
  });

  it('/api/admin/users không rơi vào /api/users', () => {
    expect(matchRoute('GET', '/api/admin/users')?.access).toBe('admin');
    expect(matchRoute('GET', '/api/users')).toBeUndefined();
  });

  it('không khớp tiền tố giả: /api/productsx, /api/cartoon', () => {
    expect(matchRoute('GET', '/api/productsx')).toBeUndefined();
    expect(matchRoute('GET', '/api/cartoon')).toBeUndefined();
  });

  it('/internal/*, /health/x và đường dẫn lạ không có route', () => {
    expect(matchRoute('GET', '/internal/users/abc')).toBeUndefined();
    expect(matchRoute('GET', '/khong-co')).toBeUndefined();
    expect(matchRoute('GET', '/api')).toBeUndefined();
  });

  it('GET /api/webhooks/payos không có route (chỉ POST)', () => {
    expect(matchRoute('GET', '/api/webhooks/payos')).toBeUndefined();
  });
});
