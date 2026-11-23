// Cấu hình assistant-service (design/ASSISTANT/README.md §4). Khung T1.6: database.
// Phần database lấy từ be/src/config/configuration.ts (như promotion), bỏ `synchronize`
// (luôn tắt, chạy migration — coding-convention §5). T8.5–T8.7: URL catalog, identity; FPT_*, AI_*, COOKIE_SECURE.

/** Đủ cho CLI migration (database/data-source.ts) */
export const DB_REQUIRED = [
  'DB_HOST',
  'DB_USER',
  'DB_PASS',
  'DB_NAME',
] as const;

// FPT_KEY không bắt buộc: rỗng thì service vẫn chạy (lịch sử, quản trị), gửi tin trả 503 NT-AST-1003
const REQUIRED = [
  ...DB_REQUIRED,
  'CATALOG_SERVICE_URL',
  'IDENTITY_SERVICE_URL',
  'FPT_BASE_URL',
] as const;

export interface ServicesConfig {
  catalogUrl: string;
  identityUrl: string;
}

/** NT.ASSISTANT_CHAT: gọi FPT AI, ngân sách thời gian (Processing_Flow §2) */
export interface AiConfig {
  baseUrl: string;
  key: string;
  model: string;
  callTimeoutMs: number;
  budgetMs: number;
  contextTtlMs: number;
}

export interface AssistantConfig {
  port: number;
  database: {
    host: string;
    port: number;
    username: string;
    password: string;
    name: string;
    ssl: boolean;
  };
  services: ServicesConfig;
  ai: AiConfig;
  cookieSecure: boolean;
}

// Thiếu biến bắt buộc thì dừng khởi động, báo rõ tên biến (coding-convention §6)
export function assertRequiredEnv(
  env: NodeJS.ProcessEnv = process.env,
  required: readonly string[] = REQUIRED,
): void {
  const missing = required.filter((k) => !env[k]);
  if (missing.length) {
    throw new Error(`Thiếu biến môi trường bắt buộc: ${missing.join(', ')}`);
  }
}

export function databaseConfig(
  env: NodeJS.ProcessEnv = process.env,
): AssistantConfig['database'] {
  return {
    host: env.DB_HOST!,
    port: Number(env.DB_PORT ?? 5432),
    username: env.DB_USER!,
    password: env.DB_PASS!,
    name: env.DB_NAME!,
    // Giống be/: mặc định bật SSL (DB cloud), Postgres local đặt DB_SSL=false
    ssl: env.DB_SSL ? env.DB_SSL === 'true' : true,
  };
}

export function aiConfig(env: NodeJS.ProcessEnv = process.env): AiConfig {
  return {
    baseUrl: env.FPT_BASE_URL!,
    key: env.FPT_KEY ?? '',
    model: env.FPT_MODEL || 'DeepSeek-V4-Flash',
    callTimeoutMs: Number(env.AI_CALL_TIMEOUT_MS ?? 30000),
    // Phải nhỏ hơn PROXY_TIMEOUT_AI_MS của gateway (80000)
    budgetMs: Number(env.AI_BUDGET_MS ?? 75000),
    contextTtlMs: Number(env.AI_CONTEXT_TTL_MS ?? 300000),
  };
}

export default (): AssistantConfig => {
  assertRequiredEnv();
  return {
    port: Number(process.env.PORT ?? 3007),
    database: databaseConfig(),
    services: {
      catalogUrl: process.env.CATALOG_SERVICE_URL!,
      identityUrl: process.env.IDENTITY_SERVICE_URL!,
    },
    ai: aiConfig(),
    cookieSecure: process.env.COOKIE_SECURE === 'true',
  };
};
