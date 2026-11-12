import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import CircuitBreaker from 'opossum';
import { currentRequestId } from '../context/request-context';
import { UpstreamBusinessError, UpstreamError } from './errors';

// Đường gọi liên service duy nhất (reliability-standard.md, NT.SERVICE_KIT §3):
// timeout từng lần, retry có backoff + jitter, circuit breaker, ngân sách `deadline`.

export interface RequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** Mặc định true với GET, false với lệnh khác. Chỉ bật khi lệnh idempotent. */
  retry?: boolean;
  timeoutMs?: number;
  /** Mốc thời gian tuyệt đối (epoch ms) của cả chuỗi gọi, ví dụ ngân sách saga. */
  deadline?: number;
}

export interface ResilientHttpClientOptions {
  target: string;
  baseUrl: string;
  /** Dịch vụ ngoài hệ thống: không gửi header nội bộ, 4xx tính là lỗi hạ tầng (ADR-0013). */
  external?: boolean;
  /** Chỉ dùng khi external: gửi kèm mọi lời gọi. */
  headers?: Record<string, string>;
}

interface AttemptOptions extends RequestOptions {
  timeoutMs?: number;
  noTimeout?: boolean;
  rawErrors?: boolean;
}

// Lỗi mạng cho biết request chắc chắn chưa tới service đích
const NOT_EXECUTED_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isBreakerOpen(err: unknown): boolean {
  return (err as { code?: string } | undefined)?.code === 'EOPENBREAKER';
}

function networkErrorCode(err: unknown): string | undefined {
  const cause = (
    err as { cause?: { code?: string; errors?: { code?: string }[] } }
  )?.cause;
  return cause?.code ?? cause?.errors?.[0]?.code;
}

export class ResilientHttpClient {
  private readonly logger: Logger;
  private readonly breaker: CircuitBreaker<[AttemptOptions], unknown>;
  private readonly enabled = process.env.RESILIENCE_ENABLED !== 'false';
  private readonly timeoutMs = Number(process.env.HTTP_TIMEOUT_MS ?? 2000);
  private readonly retries = Number(process.env.HTTP_RETRIES ?? 2);

  constructor(private readonly opts: ResilientHttpClientOptions) {
    if (!opts.baseUrl) {
      throw new Error(`Thiếu URL cho service ${opts.target}`);
    }
    this.logger = new Logger(`ResilientHttpClient:${opts.target}`);
    this.breaker = new CircuitBreaker((o: AttemptOptions) => this.attempt(o), {
      timeout: false, // timeout đã do AbortSignal xử lý
      volumeThreshold: Number(process.env.CB_VOLUME_THRESHOLD ?? 5),
      errorThresholdPercentage: Number(process.env.CB_ERROR_PERCENT ?? 50),
      resetTimeout: Number(process.env.CB_RESET_MS ?? 10000),
      rollingCountTimeout: 10000,
      // 4xx nội bộ không tính lỗi: người dùng nhập sai không được làm mở mạch
      errorFilter: (e: unknown) => e instanceof UpstreamBusinessError,
    });
    this.breaker.on('open', () =>
      this.logger.warn(`Mạch tới ${opts.target}: mở`),
    );
    this.breaker.on('halfOpen', () =>
      this.logger.warn(`Mạch tới ${opts.target}: nửa mở`),
    );
    this.breaker.on('close', () =>
      this.logger.warn(`Mạch tới ${opts.target}: đóng`),
    );
  }

  async request<T>(o: RequestOptions): Promise<T> {
    if (!this.enabled) {
      return (await this.attempt({
        ...o,
        noTimeout: true,
        rawErrors: true,
      })) as T;
    }

    const canRetry = o.retry ?? o.method === 'GET';
    const maxAttempts = canRetry ? this.retries + 1 : 1;
    let sawUnknown = false;
    let lastError: UpstreamError | undefined;

    for (let i = 0; i < maxAttempts; i++) {
      if (i > 0) await sleep(200 * 2 ** (i - 1) + Math.random() * 100);
      const now = Date.now();
      if (o.deadline && now >= o.deadline) break;
      // Cắt timeout theo phần ngân sách còn lại, để lần gọi cuối không vượt deadline
      const timeoutMs = o.deadline
        ? Math.min(o.timeoutMs ?? this.timeoutMs, o.deadline - now)
        : (o.timeoutMs ?? this.timeoutMs);
      try {
        return (await this.breaker.fire({ ...o, timeoutMs })) as T;
      } catch (err) {
        if (err instanceof UpstreamBusinessError) throw err; // 4xx: không retry
        const up = this.classify(err);
        sawUnknown ||= up.outcome === 'unknown';
        lastError = up;
        if (isBreakerOpen(err)) break; // mạch mở: dừng ngay
      }
    }

    // Chưa gọi lần nào vì hết ngân sách: 504 not_executed
    const error =
      lastError ??
      new UpstreamError(this.opts.target, 'deadline', 'not_executed', 504);
    if (sawUnknown) error.outcome = 'unknown'; // một lần unknown là unknown
    throw error;
  }

  private async attempt(o: AttemptOptions): Promise<unknown> {
    const url = new URL(o.path, this.opts.baseUrl);
    for (const [k, v] of Object.entries(o.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.opts.external) {
      Object.assign(headers, this.opts.headers);
    } else {
      headers['X-Internal-Token'] = process.env.INTERNAL_API_TOKEN ?? '';
      headers['X-Request-ID'] = currentRequestId() ?? randomUUID();
    }
    if (o.body !== undefined) headers['Content-Type'] = 'application/json';

    const res = await fetch(url, {
      method: o.method,
      headers,
      body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
      signal: o.noTimeout ? undefined : AbortSignal.timeout(o.timeoutMs!),
    });
    const data = await this.readBody(res);

    if (res.ok) return data;

    if (res.status < 500 && !this.opts.external) {
      const body = (data ?? {}) as {
        code?: string;
        message?: string | string[];
      };
      throw new UpstreamBusinessError(
        this.opts.target,
        res.status,
        body.code,
        body.message ?? res.statusText,
      );
    }
    if (o.rawErrors) {
      throw new Error(`Service ${this.opts.target} trả ${res.status}`);
    }
    // 5xx, hoặc 4xx của dịch vụ ngoài: không rõ đích đã xử lý chưa
    throw new UpstreamError(
      this.opts.target,
      `http_${res.status}`,
      'unknown',
      503,
    );
  }

  private async readBody(res: Response): Promise<unknown> {
    const text = await res.text();
    if (!text) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  private classify(err: unknown): UpstreamError {
    const t = this.opts.target;
    if (err instanceof UpstreamError) return err;
    if ((err as { name?: string } | undefined)?.name === 'TimeoutError') {
      return new UpstreamError(t, 'timeout', 'unknown', 504);
    }
    if (isBreakerOpen(err)) {
      return new UpstreamError(t, 'circuit_open', 'not_executed', 503);
    }
    const code = networkErrorCode(err);
    if (code && NOT_EXECUTED_CODES.has(code)) {
      return new UpstreamError(t, code, 'not_executed', 503);
    }
    // Ngắt kết nối giữa chừng và lỗi khác: không biết đích đã xử lý chưa
    return new UpstreamError(t, code ?? 'network', 'unknown', 503);
  }
}
