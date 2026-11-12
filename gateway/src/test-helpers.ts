import http from 'node:http';
import type { AddressInfo } from 'node:net';
import jwt from 'jsonwebtoken';
import { loadConfig, type GatewayConfig } from './config';

// Chỉ dùng trong test (loại khỏi build ở tsconfig.build.json).

export const JWT_SECRET = 'test-access-secret';
export const INTERNAL_TOKEN = 'test-internal-token';

export interface Recorded {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

export type Handler = (
  req: Recorded,
  res: http.ServerResponse,
) => void | Promise<void>;

/** Server HTTP giả cho service đích. Ghi lại mọi request, trả theo `handler`. */
export class FakeService {
  readonly requests: Recorded[] = [];
  handler: Handler = (_req, res) => json(res, 200, { ok: true });
  private server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const rec: Recorded = {
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body: Buffer.concat(chunks),
      };
      this.requests.push(rec);
      void this.handler(rec, res);
    });
  });

  async start(): Promise<string> {
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  reset(): void {
    this.requests.length = 0;
    this.handler = (_req, res) => json(res, 200, { ok: true });
  }

  async stop(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((r) => this.server.close(() => r()));
  }
}

export function json(
  res: http.ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string | string[]> = {},
): void {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Cổng không có ai lắng nghe: lấy cổng trống rồi đóng lại. */
export async function deadUrl(): Promise<string> {
  const s = http.createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address() as AddressInfo;
  await new Promise<void>((r) => s.close(() => r()));
  return `http://127.0.0.1:${port}`;
}

export function testConfig(
  urls: { service: string; identity: string },
  over: Partial<GatewayConfig> = {},
): GatewayConfig {
  const base = loadConfig({
    JWT_SECRET,
    INTERNAL_API_TOKEN: INTERNAL_TOKEN,
    IDENTITY_SERVICE_URL: urls.identity,
    CATALOG_SERVICE_URL: urls.service,
    PROMOTION_SERVICE_URL: urls.service,
    ORDER_SERVICE_URL: urls.service,
    NOTIFICATION_SERVICE_URL: urls.service,
    ASSISTANT_SERVICE_URL: urls.service,
    PROXY_TIMEOUT_MS: '300',
    PROXY_TIMEOUT_AI_MS: '1500',
    HTTP_TIMEOUT_MS: '200',
    RATE_LIMIT_PER_MIN: '0',
    RATE_LIMIT_AUTH_PER_MIN: '0',
    RATE_LIMIT_AI_PER_MIN: '0',
  });
  return { ...base, ...over };
}

export const USER = { sub: 'u1', email: 'u1@nextech.local', role: 'user' };
export const ADMIN = { sub: 'a1', email: 'admin@nextech.local', role: 'admin' };

export function accessToken(
  user: { sub: string; email: string; role: string } = USER,
  opts: { expired?: boolean; secret?: string } = {},
): string {
  return jwt.sign(user, opts.secret ?? JWT_SECRET, {
    expiresIn: opts.expired ? -10 : 60,
  });
}

/** Các dòng Set-Cookie của response supertest */
export function setCookies(res: {
  headers: Record<string, unknown>;
}): string[] {
  const v = res.headers['set-cookie'];
  if (Array.isArray(v)) return v as string[];
  return typeof v === 'string' ? [v] : [];
}
