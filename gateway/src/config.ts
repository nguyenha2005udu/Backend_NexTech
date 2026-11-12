// Đọc cấu hình từ biến môi trường (NT.GATEWAY API_Spec §6).
// Thiếu biến bắt buộc thì dừng ngay, không chạy với giá trị rỗng (coding-convention §6).

export const SERVICE_NAMES = [
  'identity',
  'catalog',
  'promotion',
  'order',
  'notification',
  'assistant',
] as const;
export type ServiceName = (typeof SERVICE_NAMES)[number];

export interface GatewayConfig {
  port: number;
  jwtSecret: string;
  internalToken: string;
  serviceUrls: Record<ServiceName, string>;
  corsOrigins: string[];
  cookieSecure: boolean;
  proxyTimeoutMs: number;
  proxyTimeoutAiMs: number;
  /** Timeout lời gọi refresh tới identity */
  httpTimeoutMs: number;
  /** 0 = tắt */
  rateLimitPerMin: number;
  rateLimitAuthPerMin: number;
  rateLimitAiPerMin: number;
}

type Env = Record<string, string | undefined>;

const urlVar = (s: ServiceName) => `${s.toUpperCase()}_SERVICE_URL`;

export function loadConfig(env: Env = process.env): GatewayConfig {
  const required = [
    'JWT_SECRET',
    'INTERNAL_API_TOKEN',
    ...SERVICE_NAMES.map(urlVar),
  ];
  const missing = required.filter((k) => !env[k]);
  if (missing.length > 0) {
    throw new Error(`Thiếu biến môi trường bắt buộc: ${missing.join(', ')}`);
  }

  const num = (k: string, def: number) => (env[k] ? Number(env[k]) : def);

  return {
    port: num('PORT', 8080),
    jwtSecret: env.JWT_SECRET!,
    internalToken: env.INTERNAL_API_TOKEN!,
    serviceUrls: Object.fromEntries(
      SERVICE_NAMES.map((s) => [s, env[urlVar(s)]!]),
    ) as Record<ServiceName, string>,
    corsOrigins: (env.CORS_ORIGINS ?? 'http://localhost:3000')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    cookieSecure: env.COOKIE_SECURE === 'true',
    proxyTimeoutMs: num('PROXY_TIMEOUT_MS', 10000),
    proxyTimeoutAiMs: num('PROXY_TIMEOUT_AI_MS', 80000),
    httpTimeoutMs: num('HTTP_TIMEOUT_MS', 2000),
    rateLimitPerMin: num('RATE_LIMIT_PER_MIN', 600),
    rateLimitAuthPerMin: num('RATE_LIMIT_AUTH_PER_MIN', 30),
    rateLimitAiPerMin: num('RATE_LIMIT_AI_PER_MIN', 20),
  };
}
