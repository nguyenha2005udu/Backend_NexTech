import http, { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { HttpException } from '@nestjs/common';
import { ResilientHttpClient } from './resilient-http-client';
import { UpstreamBusinessError, UpstreamError } from './errors';

// HTTP server thật cho test (Component_Class_Design §7: không mock fetch)
type Handler = (
  req: IncomingMessage,
  res: ServerResponse,
  call: number,
  server: TestServer,
) => void;

interface TestServer {
  url: string;
  calls: IncomingMessage[];
  handler: Handler;
  close: () => Promise<void>;
  stopListening: () => void;
}

const servers: TestServer[] = [];

async function startServer(handler: Handler): Promise<TestServer> {
  const sockets = new Set<Socket>();
  const ts = { calls: [] as IncomingMessage[], handler } as TestServer;
  const srv = http.createServer((req, res) => {
    ts.calls.push(req);
    ts.handler(req, res, ts.calls.length, ts);
  });
  srv.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  ts.url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  ts.stopListening = () => srv.close();
  ts.close = () =>
    new Promise<void>((r) => {
      sockets.forEach((s) => s.destroy());
      srv.close(() => r());
      if (!srv.listening) r();
    });
  servers.push(ts);
  return ts;
}

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};
const hang = () => undefined; // không trả lời

async function closedPortUrl(): Promise<string> {
  const ts = await startServer(hang);
  await ts.close();
  return ts.url;
}

async function catchError(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error('Mong đợi lỗi nhưng thành công');
}

const ENV_KEYS = [
  'INTERNAL_API_TOKEN',
  'HTTP_TIMEOUT_MS',
  'HTTP_RETRIES',
  'RESILIENCE_ENABLED',
  'CB_VOLUME_THRESHOLD',
  'CB_ERROR_PERCENT',
  'CB_RESET_MS',
];
const savedEnv = { ...process.env };

beforeEach(() => {
  ENV_KEYS.forEach((k) => delete process.env[k]);
  process.env.INTERNAL_API_TOKEN = 'test-token';
  process.env.HTTP_TIMEOUT_MS = '150';
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

afterAll(() => {
  process.env = savedEnv;
});

jest.setTimeout(15000);

describe('ResilientHttpClient — nội bộ', () => {
  it('thiếu baseUrl thì ném lỗi ngay khi tạo', () => {
    expect(
      () => new ResilientHttpClient({ target: 'catalog', baseUrl: '' }),
    ).toThrow(/catalog/);
  });

  it('thành công: trả dữ liệu, có X-Internal-Token và X-Request-ID', async () => {
    const s = await startServer((_req, res) => json(res, 200, { ok: 1 }));
    const c = new ResilientHttpClient({ target: 'catalog', baseUrl: s.url });

    const data = await c.request<{ ok: number }>({
      method: 'GET',
      path: '/x',
      query: { a: '1' },
    });

    expect(data).toEqual({ ok: 1 });
    expect(s.calls[0].url).toBe('/x?a=1');
    expect(s.calls[0].headers['x-internal-token']).toBe('test-token');
    expect(s.calls[0].headers['x-request-id']).toEqual(expect.any(String));
  });

  it('409: ném UpstreamBusinessError, gọi 1 lần, giữ code và message', async () => {
    const s = await startServer((_req, res) =>
      json(res, 409, {
        statusCode: 409,
        code: 'NT-CAT-1001',
        message: 'Hết hàng',
      }),
    );
    const c = new ResilientHttpClient({ target: 'catalog', baseUrl: s.url });

    const err = await catchError(c.request({ method: 'GET', path: '/x' }));

    expect(err).toBeInstanceOf(UpstreamBusinessError);
    const e = err as UpstreamBusinessError;
    expect(e.getStatus()).toBe(409);
    expect(e.upstreamCode).toBe('NT-CAT-1001');
    expect(e.message).toBe('Hết hàng');
    expect(s.calls).toHaveLength(1);
  });

  it('GET: 500 hai lần rồi 200 thì thành công ở lần 3', async () => {
    const s = await startServer((_req, res, n) =>
      n <= 2 ? json(res, 500, {}) : json(res, 200, { ok: true }),
    );
    const c = new ResilientHttpClient({ target: 'catalog', baseUrl: s.url });

    await expect(c.request({ method: 'GET', path: '/x' })).resolves.toEqual({
      ok: true,
    });
    expect(s.calls).toHaveLength(3);
  });

  it('POST không có retry: true trả 500: gọi 1 lần, 503 unknown', async () => {
    const s = await startServer((_req, res) => json(res, 500, {}));
    const c = new ResilientHttpClient({ target: 'catalog', baseUrl: s.url });

    const err = (await catchError(
      c.request({ method: 'POST', path: '/x', body: { a: 1 } }),
    )) as UpstreamError;

    expect(err).toBeInstanceOf(UpstreamError);
    expect(err.getStatus()).toBe(503);
    expect(err.outcome).toBe('unknown');
    expect(err.code).toBe('NT-GEN-0503');
    expect(s.calls).toHaveLength(1);
  });

  it('server không trả lời: 504 unknown sau khoảng timeoutMs × 3', async () => {
    const s = await startServer(hang);
    const c = new ResilientHttpClient({ target: 'catalog', baseUrl: s.url });

    const t0 = Date.now();
    const err = (await catchError(
      c.request({ method: 'GET', path: '/x' }),
    )) as UpstreamError;
    const elapsed = Date.now() - t0;

    expect(err).toBeInstanceOf(UpstreamError);
    expect(err.getStatus()).toBe(504);
    expect(err.outcome).toBe('unknown');
    expect(err.code).toBe('NT-GEN-0504');
    expect(s.calls).toHaveLength(3);
    // 3 × 150 ms + backoff 200 + 400 (+ jitter tối đa 200)
    expect(elapsed).toBeGreaterThanOrEqual(150 * 3 + 600);
    expect(elapsed).toBeLessThan(150 * 3 + 600 + 600);
  });

  it('không có server: 503 not_executed', async () => {
    const url = await closedPortUrl();
    const c = new ResilientHttpClient({ target: 'catalog', baseUrl: url });

    const err = (await catchError(
      c.request({ method: 'GET', path: '/x' }),
    )) as UpstreamError;

    expect(err).toBeInstanceOf(UpstreamError);
    expect(err.getStatus()).toBe(503);
    expect(err.outcome).toBe('not_executed');
  });

  it('không phân giải được tên miền: 503 not_executed', async () => {
    const c = new ResilientHttpClient({
      target: 'catalog',
      baseUrl: 'http://khong-ton-tai.invalid',
    });

    const err = (await catchError(
      c.request({ method: 'POST', path: '/x' }),
    )) as UpstreamError;

    expect(err).toBeInstanceOf(UpstreamError);
    expect(err.getStatus()).toBe(503);
    expect(err.outcome).toBe('not_executed');
  });

  it('lần đầu timeout, lần sau từ chối kết nối: outcome vẫn unknown', async () => {
    const s = await startServer((_req, _res, n, server) => {
      if (n === 1) server.stopListening(); // treo lần 1 và ngừng nhận kết nối mới
    });
    const c = new ResilientHttpClient({ target: 'catalog', baseUrl: s.url });

    const err = (await catchError(
      c.request({ method: 'POST', path: '/x', retry: true }),
    )) as UpstreamError;

    expect(err).toBeInstanceOf(UpstreamError);
    expect(err.outcome).toBe('unknown');
    expect(s.calls).toHaveLength(1);
  });

  it('5 lỗi liên tiếp: mạch mở, lần sau trả 503 dưới 50 ms', async () => {
    const s = await startServer((_req, res) => json(res, 500, {}));
    const c = new ResilientHttpClient({ target: 'catalog', baseUrl: s.url });

    for (let i = 0; i < 5; i++) {
      await catchError(c.request({ method: 'POST', path: '/x' }));
    }
    const t0 = Date.now();
    const err = (await catchError(
      c.request({ method: 'POST', path: '/x' }),
    )) as UpstreamError;

    expect(Date.now() - t0).toBeLessThan(50);
    expect(err.getStatus()).toBe(503);
    expect(err.outcome).toBe('not_executed');
    expect(s.calls).toHaveLength(5);
  });

  it('5 lần 404: mạch vẫn đóng', async () => {
    const s = await startServer((req, res) =>
      req.url === '/ok' ? json(res, 200, { ok: 1 }) : json(res, 404, {}),
    );
    const c = new ResilientHttpClient({ target: 'catalog', baseUrl: s.url });

    for (let i = 0; i < 5; i++) {
      await catchError(c.request({ method: 'GET', path: '/x' }));
    }

    await expect(c.request({ method: 'GET', path: '/ok' })).resolves.toEqual({
      ok: 1,
    });
  });

  it('sau resetTimeout, server khoẻ lại: mạch đóng', async () => {
    process.env.CB_RESET_MS = '200';
    let healthy = false;
    const s = await startServer((_req, res) =>
      healthy ? json(res, 200, { ok: 1 }) : json(res, 500, {}),
    );
    const c = new ResilientHttpClient({ target: 'catalog', baseUrl: s.url });
    for (let i = 0; i < 5; i++) {
      await catchError(c.request({ method: 'POST', path: '/x' }));
    }
    healthy = true;
    await new Promise((r) => setTimeout(r, 250));

    await expect(c.request({ method: 'POST', path: '/x' })).resolves.toEqual({
      ok: 1,
    });
    await expect(c.request({ method: 'POST', path: '/x' })).resolves.toEqual({
      ok: 1,
    });
  });

  it('RESILIENCE_ENABLED=false: không retry, lỗi trần', async () => {
    process.env.RESILIENCE_ENABLED = 'false';
    const s = await startServer((_req, res) => json(res, 500, {}));
    const c = new ResilientHttpClient({ target: 'catalog', baseUrl: s.url });

    const err = await catchError(c.request({ method: 'GET', path: '/x' }));

    expect(err).not.toBeInstanceOf(HttpException);
    expect(s.calls).toHaveLength(1);
  });

  it('quá deadline: không gọi thêm', async () => {
    const s = await startServer((_req, res) => json(res, 500, {}));
    const c = new ResilientHttpClient({ target: 'catalog', baseUrl: s.url });

    await catchError(
      c.request({ method: 'GET', path: '/x', deadline: Date.now() + 150 }),
    );

    // Lần 2 sớm nhất sau 200 ms backoff, lúc đó deadline đã qua
    expect(s.calls).toHaveLength(1);
  });

  it('deadline còn 300 ms, timeoutMs 2000, server treo: lỗi sau khoảng 300 ms', async () => {
    const s = await startServer(hang);
    const c = new ResilientHttpClient({ target: 'catalog', baseUrl: s.url });

    const t0 = Date.now();
    const err = (await catchError(
      c.request({
        method: 'POST',
        path: '/x',
        timeoutMs: 2000,
        deadline: Date.now() + 300,
      }),
    )) as UpstreamError;
    const elapsed = Date.now() - t0;

    expect(err.getStatus()).toBe(504);
    expect(err.outcome).toBe('unknown');
    expect(elapsed).toBeGreaterThanOrEqual(250);
    expect(elapsed).toBeLessThan(700);
  });

  it('deadline đã hết trước lần gọi đầu: 504 not_executed, không gọi server', async () => {
    const s = await startServer((_req, res) => json(res, 200, {}));
    const c = new ResilientHttpClient({ target: 'catalog', baseUrl: s.url });

    const err = (await catchError(
      c.request({ method: 'GET', path: '/x', deadline: Date.now() - 1 }),
    )) as UpstreamError;

    expect(err).toBeInstanceOf(UpstreamError);
    expect(err.getStatus()).toBe(504);
    expect(err.outcome).toBe('not_executed');
    expect(s.calls).toHaveLength(0);
  });
});

describe('ResilientHttpClient — external', () => {
  const ext = (url: string) =>
    new ResilientHttpClient({
      target: 'photon',
      baseUrl: url,
      external: true,
      headers: { 'User-Agent': 'NexTech-Shopping-App/1.0' },
    });

  it('không gửi X-Internal-Token, X-Request-ID; có headers đã khai', async () => {
    const s = await startServer((_req, res) => json(res, 200, { ok: 1 }));

    await ext(s.url).request({ method: 'GET', path: '/api' });

    const h = s.calls[0].headers;
    expect(h['x-internal-token']).toBeUndefined();
    expect(h['x-request-id']).toBeUndefined();
    expect(h['user-agent']).toBe('NexTech-Shopping-App/1.0');
  });

  it('401 từ đích: UpstreamError 503, không phải UpstreamBusinessError', async () => {
    const s = await startServer((_req, res) => json(res, 401, {}));

    const err = await catchError(
      ext(s.url).request({ method: 'GET', path: '/api', retry: false }),
    );

    expect(err).toBeInstanceOf(UpstreamError);
    expect(err).not.toBeInstanceOf(UpstreamBusinessError);
    expect((err as UpstreamError).getStatus()).toBe(503);
  });

  it('5 lần 429 liên tiếp: mạch mở', async () => {
    const s = await startServer((_req, res) => json(res, 429, {}));
    const c = ext(s.url);

    for (let i = 0; i < 5; i++) {
      await catchError(
        c.request({ method: 'GET', path: '/api', retry: false }),
      );
    }
    const err = (await catchError(
      c.request({ method: 'GET', path: '/api', retry: false }),
    )) as UpstreamError;

    expect(err.outcome).toBe('not_executed');
    expect(s.calls).toHaveLength(5);
  });

  it('treo: 504 sau timeoutMs', async () => {
    const s = await startServer(hang);

    const t0 = Date.now();
    const err = (await catchError(
      ext(s.url).request({ method: 'GET', path: '/api', retry: false }),
    )) as UpstreamError;

    expect(err.getStatus()).toBe(504);
    expect(Date.now() - t0).toBeLessThan(500);
  });
});
