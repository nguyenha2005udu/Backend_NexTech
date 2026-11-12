import type { Express } from 'express';
import request from 'supertest';
import { createApp } from './app';
import type { GatewayConfig } from './config';
import {
  ADMIN,
  FakeService,
  INTERNAL_TOKEN,
  USER,
  accessToken,
  deadUrl,
  json,
  setCookies,
  sleep,
  testConfig,
} from './test-helpers';

// Test bắt buộc NT.GATEWAY Component_Class_Design §6. Service đích và identity là server HTTP thật.
// Thời gian thu nhỏ: PROXY_TIMEOUT_MS 300, PROXY_TIMEOUT_AI_MS 1500, HTTP_TIMEOUT_MS 200.

const svc = new FakeService();
const idn = new FakeService();
let urls: { service: string; identity: string };
let app: Express;
// Body JSON của supertest là any: đọc qua kiểu này cho lint
interface Body {
  code?: string;
  message?: unknown;
  request_id?: unknown;
  services?: Record<string, string>;
}
const bodyOf = (res: { body: unknown }) => res.body as Body;
const make = (over: Partial<GatewayConfig> = {}) =>
  createApp(testConfig(urls, over));

beforeAll(async () => {
  urls = { service: await svc.start(), identity: await idn.start() };
});
afterAll(async () => {
  await svc.stop();
  await idn.stop();
});
beforeEach(() => {
  svc.reset();
  idn.reset();
  app = make();
});

describe('endpoint của gateway và bảng route', () => {
  it('GET /health → 200, không gọi service', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', service: 'gateway' });
    expect(svc.requests).toHaveLength(0);
  });

  it('đường dẫn không có route → 404 NT-GW-0404, body theo api-convention §5', async () => {
    const res = await request(app).get('/khong-co');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({
      statusCode: 404,
      code: 'NT-GW-0404',
      error: 'Not Found',
    });
    expect(typeof bodyOf(res).message).toBe('string');
    expect(bodyOf(res).request_id).toBe(res.headers['x-request-id']);
  });

  it('/internal/* → 404, không lọt vào service', async () => {
    const res = await request(app)
      .get('/internal/users/abc')
      .set('X-Internal-Token', 'x');
    expect(res.status).toBe(404);
    expect(svc.requests).toHaveLength(0);
    expect(idn.requests).toHaveLength(0);
  });

  it('giữ X-Request-ID của client, không có thì sinh mới', async () => {
    const a = await request(app)
      .get('/khong-co')
      .set('X-Request-ID', 'req-123');
    expect(a.headers['x-request-id']).toBe('req-123');
    const b = await request(app).get('/khong-co');
    expect(b.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('không lộ x-powered-by', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('chuyển tiếp (proxy)', () => {
  it('đường dẫn và query đi nguyên vẹn, gắn X-Internal-Token và X-Request-ID', async () => {
    svc.handler = (_r, res) => json(res, 200, { items: [1] });
    const res = await request(app)
      .get('/api/products?page=2')
      .set('X-Request-ID', 'rid-1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [1] });
    expect(svc.requests[0].url).toBe('/api/products?page=2');
    expect(svc.requests[0].headers['x-internal-token']).toBe(INTERNAL_TOKEN);
    expect(svc.requests[0].headers['x-request-id']).toBe('rid-1');
  });

  it('client gửi X-User-* và X-Internal-Token giả: service không nhận được', async () => {
    await request(app)
      .get('/api/products')
      .set('X-User-Id', 'admin')
      .set('X-User-Role', 'admin')
      .set('X-User-Email', 'x@y.z')
      .set('X-Internal-Token', 'gia-mao');
    const h = svc.requests[0].headers;
    expect(h['x-user-id']).toBeUndefined();
    expect(h['x-user-role']).toBeUndefined();
    expect(h['x-user-email']).toBeUndefined();
    expect(h['x-internal-token']).toBe(INTERNAL_TOKEN);
  });

  it('lỗi của service chuyển nguyên, gateway không sửa', async () => {
    const body = {
      statusCode: 409,
      code: 'NT-PRM-1003',
      message: 'Mã đã hết lượt',
    };
    svc.handler = (_r, res) => json(res, 409, body);
    const res = await request(app).post('/api/discount-codes/apply');
    expect(res.status).toBe(409);
    expect(res.body).toEqual(body);
  });

  it('body JSON của POST tới nguyên vẹn, không treo', async () => {
    const payload = { code: 'GIAM10', subtotal: 100000 };
    const res = await request(app)
      .post('/api/discount-codes/apply')
      .send(payload);
    expect(res.status).toBe(200);
    expect(JSON.parse(svc.requests[0].body.toString())).toEqual(payload);
  });

  it('upload multipart: file tới nguyên vẹn', async () => {
    const file = Buffer.from(Array.from({ length: 70000 }, (_, i) => i % 256));
    const res = await request(app)
      .post('/api/discount-codes/upload')
      .field('name', 'anh')
      .attach('image', file, 'a.bin');
    expect(res.status).toBe(200);
    const r = svc.requests[0];
    expect(r.headers['content-type']).toMatch(
      /^multipart\/form-data; boundary=/,
    );
    expect(r.body.includes(file)).toBe(true);
  });

  it('cookie guest_id tới service nguyên vẹn, Set-Cookie về client nguyên vẹn', async () => {
    svc.handler = (_r, res) =>
      json(
        res,
        201,
        { id: 'c1' },
        { 'Set-Cookie': 'guest_id=g2; Path=/; HttpOnly' },
      );
    const res = await request(app)
      .post('/api/chat')
      .set('Cookie', 'guest_id=g1');
    expect(svc.requests[0].headers.cookie).toBe('guest_id=g1');
    expect(setCookies(res)).toEqual(['guest_id=g2; Path=/; HttpOnly']);
  });

  it('service đích tắt → 503 NT-GW-0503', async () => {
    const dead = await deadUrl();
    const cfg = testConfig({ service: dead, identity: urls.identity });
    const res = await request(createApp(cfg)).get('/api/products');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      code: 'NT-GW-0503',
      request_id: expect.any(String) as string,
    });
    expect(JSON.stringify(res.body)).not.toContain('127.0.0.1');
  });

  it('service đích treo → 504 NT-GW-0504 sau PROXY_TIMEOUT_MS', async () => {
    svc.handler = async (_r, res) => {
      await sleep(1000);
      json(res, 200, {});
    };
    const t0 = Date.now();
    const res = await request(app).get('/api/products');
    const ms = Date.now() - t0;
    expect(res.status).toBe(504);
    expect(bodyOf(res).code).toBe('NT-GW-0504');
    expect(ms).toBeGreaterThanOrEqual(280);
    expect(ms).toBeLessThan(800);
  });

  it('route AI: service trả sau 600 ms vẫn 200, không bị cắt ở 300 ms', async () => {
    svc.handler = async (_r, res) => {
      await sleep(600);
      json(res, 200, { reply: 'ok' });
    };
    const res = await request(app).post('/api/chat');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reply: 'ok' });
  });

  it('route thường cùng độ trễ vẫn 504 ở PROXY_TIMEOUT_MS', async () => {
    svc.handler = async (_r, res) => {
      await sleep(600);
      json(res, 200, {});
    };
    const res = await request(app).get('/api/products');
    expect(res.status).toBe(504);
  });
});

describe('xác thực theo mức truy cập', () => {
  const auth = (t: string) => ['Cookie', `access_token=${t}`] as const;

  it('không token vào /api/orders → 401 NT-GW-0401, không gọi service', async () => {
    const res = await request(app).get('/api/orders');
    expect(res.status).toBe(401);
    expect(bodyOf(res).code).toBe('NT-GW-0401');
    expect(svc.requests).toHaveLength(0);
  });

  it('token hợp lệ: service nhận X-User-Id, X-User-Email, X-User-Role', async () => {
    const res = await request(app)
      .get('/api/orders')
      .set(...auth(accessToken(USER)));
    expect(res.status).toBe(200);
    const h = svc.requests[0].headers;
    expect([h['x-user-id'], h['x-user-email'], h['x-user-role']]).toEqual([
      USER.sub,
      USER.email,
      USER.role,
    ]);
  });

  it('nhận Authorization: Bearer khi không có cookie', async () => {
    const res = await request(app)
      .get('/api/orders')
      .set('Authorization', `Bearer ${accessToken(USER)}`);
    expect(res.status).toBe(200);
    expect(svc.requests[0].headers['x-user-id']).toBe(USER.sub);
  });

  it('client giả X-User-Id của người khác cùng token thật: service nhận id trong token', async () => {
    await request(app)
      .get('/api/orders')
      .set(...auth(accessToken(USER)))
      .set('X-User-Id', 'a1');
    expect(svc.requests[0].headers['x-user-id']).toBe(USER.sub);
  });

  it('token user vào /api/admin/orders → 403 NT-GW-0003', async () => {
    const res = await request(app)
      .get('/api/admin/orders')
      .set(...auth(accessToken(USER)));
    expect(res.status).toBe(403);
    expect(bodyOf(res).code).toBe('NT-GW-0003');
    expect(svc.requests).toHaveLength(0);
  });

  it('token admin vào route admin → đi qua', async () => {
    const res = await request(app)
      .get('/api/admin/orders')
      .set(...auth(accessToken(ADMIN)));
    expect(res.status).toBe(200);
    expect(svc.requests[0].headers['x-user-role']).toBe('admin');
  });

  it('header X-User-Role: admin giả, không token → 401', async () => {
    const res = await request(app)
      .get('/api/admin/users')
      .set('X-User-Role', 'admin');
    expect(res.status).toBe(401);
  });

  it('token sai chữ ký → 401, không gọi identity dù có refresh_token', async () => {
    const bad = accessToken(USER, { secret: 'khoa-khac' });
    const res = await request(app)
      .get('/api/orders')
      .set('Cookie', `access_token=${bad}; refresh_token=r1`);
    expect(res.status).toBe(401);
    expect(idn.requests).toHaveLength(0);
  });

  it('route public không gắn X-User-* dù có token', async () => {
    await request(app)
      .get('/api/products')
      .set(...auth(accessToken(USER)));
    expect(svc.requests[0].headers['x-user-id']).toBeUndefined();
  });

  it('POST /api/orders: body tới nguyên vẹn, không treo', async () => {
    const payload = {
      address_id: 'a1',
      payment_method: 'cod',
      items: [{ product_id: 'p1', quantity: 2 }],
    };
    const res = await request(app)
      .post('/api/orders')
      .set(...auth(accessToken(USER)))
      .send(payload);
    expect(res.status).toBe(200);
    expect(JSON.parse(svc.requests[0].body.toString())).toEqual(payload);
  });

  it('optional, không token: đi tiếp, không có X-User-*', async () => {
    const res = await request(app).post('/api/conversations');
    expect(res.status).toBe(200);
    expect(svc.requests[0].headers['x-user-id']).toBeUndefined();
  });

  it('optional, token hợp lệ: có X-User-*', async () => {
    await request(app)
      .post('/api/conversations')
      .set(...auth(accessToken(USER)));
    expect(svc.requests[0].headers['x-user-id']).toBe(USER.sub);
  });

  it('optional, sai chữ ký: đi tiếp như khách, không gọi identity', async () => {
    const bad = accessToken(USER, { secret: 'khoa-khac' });
    const res = await request(app)
      .post('/api/conversations')
      .set('Cookie', `access_token=${bad}; refresh_token=r1`);
    expect(res.status).toBe(200);
    expect(svc.requests[0].headers['x-user-id']).toBeUndefined();
    expect(idn.requests).toHaveLength(0);
  });
});

describe('refresh hộ client', () => {
  const expired = () => accessToken(USER, { expired: true });
  const NEW_ACCESS = () => accessToken(USER);
  const okRefresh = (delayMs = 0) => {
    idn.handler = async (_r, res) => {
      if (delayMs) await sleep(delayMs);
      json(res, 200, {
        access_token: NEW_ACCESS(),
        refresh_token: 'r2',
        access_ttl_s: 900,
        refresh_ttl_s: 604800,
        user: USER,
      });
    };
  };
  const cookieOf = (cookies: string[], name: string) =>
    cookies.find((c) => c.startsWith(`${name}=`));
  const isCleared = (c?: string) => !!c && /Expires=Thu, 01 Jan 1970/.test(c);

  it('hết hạn + refresh hợp lệ → 200, Set-Cookie mới, service nhận user mới', async () => {
    okRefresh();
    const res = await request(app)
      .get('/api/orders')
      .set('Cookie', `access_token=${expired()}; refresh_token=r1`);
    expect(res.status).toBe(200);
    const cookies = setCookies(res);
    expect(cookieOf(cookies, 'refresh_token')).toMatch(
      /^refresh_token=r2; Max-Age=604800;.*HttpOnly; SameSite=Lax/,
    );
    expect(cookieOf(cookies, 'access_token')).toMatch(
      /Max-Age=900;.*HttpOnly; SameSite=Lax/,
    );
    expect(cookieOf(cookies, 'access_token')).not.toMatch(/Secure/);
    expect(svc.requests[0].headers['x-user-id']).toBe(USER.sub);

    const call = idn.requests[0];
    expect(call.method).toBe('POST');
    expect(call.url).toBe('/internal/auth/refresh');
    expect(call.headers['x-internal-token']).toBe(INTERNAL_TOKEN);
    expect(call.headers['content-type']).toMatch(/application\/json/);
    expect(JSON.parse(call.body.toString())).toEqual({ refresh_token: 'r1' });
  });

  it('không có access token nhưng có refresh_token → cũng refresh', async () => {
    okRefresh();
    const res = await request(app)
      .get('/api/orders')
      .set('Cookie', 'refresh_token=r1');
    expect(res.status).toBe(200);
    expect(idn.requests).toHaveLength(1);
  });

  it('hết hạn, không có refresh_token → 401, không gọi identity', async () => {
    const res = await request(app)
      .get('/api/orders')
      .set('Cookie', `access_token=${expired()}`);
    expect(res.status).toBe(401);
    expect(idn.requests).toHaveLength(0);
  });

  it.each([401, 403])(
    'user, hết hạn + identity từ chối %i → 401, xoá 2 cookie',
    async (status) => {
      idn.handler = (_r, res) =>
        json(res, status, { statusCode: status, code: 'NT-IDN-1001' });
      const res = await request(app)
        .get('/api/orders')
        .set('Cookie', `access_token=${expired()}; refresh_token=r1`);
      expect(res.status).toBe(401);
      expect(bodyOf(res).code).toBe('NT-GW-0401');
      const cookies = setCookies(res);
      expect(isCleared(cookieOf(cookies, 'access_token'))).toBe(true);
      expect(isCleared(cookieOf(cookies, 'refresh_token'))).toBe(true);
      expect(svc.requests).toHaveLength(0);
    },
  );

  it('optional, hết hạn + refresh bị từ chối → đi tiếp như khách, xoá 2 cookie', async () => {
    idn.handler = (_r, res) => json(res, 401, { statusCode: 401 });
    const res = await request(app)
      .post('/api/conversations')
      .set('Cookie', `access_token=${expired()}; refresh_token=r1`);
    expect(res.status).toBe(200);
    expect(svc.requests[0].headers['x-user-id']).toBeUndefined();
    const cookies = setCookies(res);
    expect(isCleared(cookieOf(cookies, 'access_token'))).toBe(true);
    expect(isCleared(cookieOf(cookies, 'refresh_token'))).toBe(true);
  });

  it('hết hạn + identity chết → 503, không xoá cookie', async () => {
    const cfg = testConfig({
      service: urls.service,
      identity: await deadUrl(),
    });
    const res = await request(createApp(cfg))
      .get('/api/orders')
      .set('Cookie', `access_token=${expired()}; refresh_token=r1`);
    expect(res.status).toBe(503);
    expect(bodyOf(res).code).toBe('NT-GW-0503');
    expect(setCookies(res)).toEqual([]);
  });

  it('optional, hết hạn + identity chết → 503, không coi là khách', async () => {
    const cfg = testConfig({
      service: urls.service,
      identity: await deadUrl(),
    });
    const res = await request(createApp(cfg))
      .post('/api/conversations')
      .set('Cookie', `access_token=${expired()}; refresh_token=r1`);
    expect(res.status).toBe(503);
    expect(svc.requests).toHaveLength(0);
  });

  it('identity trả 5xx khi refresh → 503, không xoá cookie', async () => {
    idn.handler = (_r, res) => json(res, 500, { statusCode: 500 });
    const res = await request(app)
      .get('/api/orders')
      .set('Cookie', `access_token=${expired()}; refresh_token=r1`);
    expect(res.status).toBe(503);
    expect(setCookies(res)).toEqual([]);
  });

  it('identity treo khi refresh → 503 sau HTTP_TIMEOUT_MS', async () => {
    okRefresh(1000);
    const t0 = Date.now();
    const res = await request(app)
      .get('/api/orders')
      .set('Cookie', `access_token=${expired()}; refresh_token=r1`);
    const ms = Date.now() - t0;
    expect(res.status).toBe(503);
    expect(ms).toBeGreaterThanOrEqual(180);
    expect(ms).toBeLessThan(700);
  });

  it('hai request cùng refresh token → chỉ một lời gọi tới identity', async () => {
    okRefresh(100);
    const cookie = `access_token=${expired()}; refresh_token=r1`;
    const [a, b] = await Promise.all([
      request(app).get('/api/orders').set('Cookie', cookie),
      request(app).get('/api/cart').set('Cookie', cookie),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(idn.requests).toHaveLength(1);
    expect(cookieOf(setCookies(b), 'refresh_token')).toMatch(
      /^refresh_token=r2;/,
    );
  });

  it('refresh xong mà service cũng gắn cookie → client nhận đủ cả hai', async () => {
    okRefresh();
    svc.handler = (_r, res) =>
      json(
        res,
        201,
        { id: 'c1' },
        { 'Set-Cookie': 'guest_id=g1; Path=/; HttpOnly' },
      );
    const res = await request(app)
      .post('/api/conversations')
      .set('Cookie', `access_token=${expired()}; refresh_token=r1`);
    const cookies = setCookies(res);
    expect(cookieOf(cookies, 'access_token')).toBeDefined();
    expect(cookieOf(cookies, 'refresh_token')).toBeDefined();
    expect(cookieOf(cookies, 'guest_id')).toBe('guest_id=g1; Path=/; HttpOnly');
  });

  it('COOKIE_SECURE=true → cookie có Secure', async () => {
    okRefresh();
    const res = await request(make({ cookieSecure: true }))
      .get('/api/orders')
      .set('Cookie', `access_token=${expired()}; refresh_token=r1`);
    expect(cookieOf(setCookies(res), 'access_token')).toMatch(/Secure/);
  });
});

describe('rate limit', () => {
  it('vượt RATE_LIMIT_AI_PER_MIN → 429 NT-GW-0429 chỉ ở route AI', async () => {
    const a = make({ rateLimitAiPerMin: 2 });
    await request(a).post('/api/chat');
    await request(a).post('/api/chat');
    const over = await request(a).post('/api/chat');
    expect(over.status).toBe(429);
    expect(bodyOf(over).code).toBe('NT-GW-0429');
    expect((await request(a).post('/api/conversations')).status).toBe(200);
    expect((await request(a).get('/api/products')).status).toBe(200);
  });

  it('vượt RATE_LIMIT_AUTH_PER_MIN → 429 ở route đăng nhập, route khác vẫn qua', async () => {
    const a = make({ rateLimitAuthPerMin: 2 });
    await request(a).post('/api/auth/login');
    await request(a).post('/api/auth/send-otp');
    expect((await request(a).post('/api/auth/verify-otp')).status).toBe(429);
    expect((await request(a).post('/api/auth/forgot-password')).status).toBe(
      429,
    );
    expect((await request(a).post('/api/auth/register')).status).toBe(200);
    expect((await request(a).get('/api/products')).status).toBe(200);
  });

  it('vượt RATE_LIMIT_PER_MIN → 429 cho mọi route, /health không bị chặn', async () => {
    const a = make({ rateLimitPerMin: 2 });
    await request(a).get('/api/products');
    await request(a).get('/khong-co');
    expect((await request(a).get('/api/products')).status).toBe(429);
    expect((await request(a).get('/health')).status).toBe(200);
  });
});

describe('GET /health/services', () => {
  it('gọi /health từng service: sống → up, tắt → down', async () => {
    const cfg = testConfig({
      service: await deadUrl(),
      identity: urls.identity,
    });
    const res = await request(createApp(cfg)).get('/health/services');
    expect(res.status).toBe(200);
    expect(bodyOf(res).services).toEqual({
      identity: 'up',
      catalog: 'down',
      promotion: 'down',
      order: 'down',
      notification: 'down',
      assistant: 'down',
    });
    expect(idn.requests[0].url).toBe('/health');
  });

  it('service treo hoặc trả 503 → down, trả lời trong khoảng 1 giây', async () => {
    idn.handler = async (_r, res) => {
      await sleep(3000);
      json(res, 200, {});
    };
    svc.handler = (_r, res) => json(res, 503, { status: 'down' });
    const t0 = Date.now();
    const res = await request(app).get('/health/services');
    expect(Date.now() - t0).toBeLessThan(1800);
    expect(bodyOf(res).services?.identity).toBe('down');
    expect(bodyOf(res).services?.catalog).toBe('down');
  });
});
