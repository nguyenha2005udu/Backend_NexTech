// Cấu hình order-service (NT.ORDER API_Spec §4). Khung T1.6: database. T3.1: URL 3 service.
// Phần database lấy từ be/src/config/configuration.ts (như promotion), bỏ `synchronize`
// (luôn tắt, chạy migration — coding-convention §5). Biến của nghiệp vụ thêm khi có code dùng:
// SHIPPING_*, SAGA_* ở T3.3; SAGA_RECONCILE_INTERVAL_MS, RESILIENCE_ENABLED ở T3.5; PAYOS_* ở T3.6; REDIS_*, ORDER_LOCK_*, DB_LOCK_TIMEOUT_MS, DB_IDLE_TX_TIMEOUT_MS ở T3.9; ORDER_HOLD_* ở T3.10.

/** Đủ cho CLI migration (database/data-source.ts) */
export const DB_REQUIRED = [
  'DB_HOST',
  'DB_USER',
  'DB_PASS',
  'DB_NAME',
] as const;

const REQUIRED = [
  ...DB_REQUIRED,
  'IDENTITY_SERVICE_URL',
  'CATALOG_SERVICE_URL',
  'PROMOTION_SERVICE_URL',
] as const;

export interface ServicesConfig {
  identityUrl: string;
  catalogUrl: string;
  promotionUrl: string;
}

/** NT.ORDER API_Spec §4, NT.CHECKOUT_SAGA API_Spec §5 */
export interface CheckoutConfig {
  shippingFee: number;
  freeShippingThreshold: number;
  budgetMs: number;
  deadlineMs: number;
  /** Chu kỳ cron đối soát (NT.CHECKOUT_SAGA Component_Class_Design §7) */
  reconcileIntervalMs: number;
  /** false: tắt cron đối soát khi đo baseline "chưa xử lý" (architecture §8) */
  resilienceEnabled: boolean;
}

export interface OrderConfig {
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
  checkout: CheckoutConfig;
  payos: PayosConfig;
  redis: RedisConfig;
  orderLock: OrderLockConfig;
  dbLock: DbLockConfig;
}

/** NT.ORDER_HOLD API_Spec §5, Component_Class_Design §2: client Redis trả lỗi nhanh, DB 1 (tách identity) */
export interface RedisConfig {
  host: string;
  port: number;
  password: string | undefined;
  tls: boolean;
  db: number;
  commandTimeoutMs: number;
  connectTimeoutMs: number;
}

/** Khoá đơn có thời hạn (BR-20, NT.ORDER_HOLD §3, §5) */
export interface OrderLockConfig {
  ttlMs: number;
  waitMs: number;
  retryMs: number;
}

/** Tham số kết nối Postgres của ứng dụng (NT.ORDER_HOLD Component_Class_Design §9) */
export interface DbLockConfig {
  lockTimeoutMs: number;
  idleTxTimeoutMs: number;
}

/** NT.PAYMENT API_Spec §5. PAYOS_BASE_URL do SDK tự đọc, không có ở đây */
export interface PayosConfig {
  clientId: string;
  apiKey: string;
  checksumKey: string;
  returnUrl: string;
  cancelUrl: string;
  timeoutMs: number;
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
): OrderConfig['database'] {
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

// URL service bắt buộc lấy từ env (architecture §8)
export function servicesConfig(
  env: NodeJS.ProcessEnv = process.env,
): ServicesConfig {
  return {
    identityUrl: env.IDENTITY_SERVICE_URL!,
    catalogUrl: env.CATALOG_SERVICE_URL!,
    promotionUrl: env.PROMOTION_SERVICE_URL!,
  };
}

// Có mặc định, không bắt buộc. Phí, ngưỡng như hằng SHIPPING_FEE, FREE_SHIPPING_THRESHOLD của
// be/src/users/order/order.service.ts
export function checkoutConfig(
  env: NodeJS.ProcessEnv = process.env,
): CheckoutConfig {
  return {
    shippingFee: Number(env.SHIPPING_FEE ?? 30000),
    freeShippingThreshold: Number(env.FREE_SHIPPING_THRESHOLD ?? 500000),
    budgetMs: Number(env.SAGA_BUDGET_MS ?? 8000),
    deadlineMs: Number(env.SAGA_DEADLINE_MS ?? 120000),
    reconcileIntervalMs: Number(env.SAGA_RECONCILE_INTERVAL_MS ?? 10000),
    // Cùng quy ước với ResilientHttpClient của service-kit: chỉ 'false' mới tắt
    resilienceEnabled: env.RESILIENCE_ENABLED !== 'false',
  };
}

// Mặc định dev như .env.example: chạy được không cần khoá PayOS thật (security-policy §1). be/ chỉ cảnh báo
// khi thiếu khoá (be/src/config/payos.ts); nay có giá trị dev nên không cần cảnh báo.
export function payosConfig(env: NodeJS.ProcessEnv = process.env): PayosConfig {
  return {
    clientId: env.PAYOS_CLIENT_ID ?? 'dev',
    apiKey: env.PAYOS_API_KEY ?? 'dev',
    checksumKey: env.PAYOS_CHECKSUM_KEY ?? 'dev-checksum',
    returnUrl: env.PAYOS_RETURN_URL ?? 'http://localhost:3000/payment/success',
    cancelUrl: env.PAYOS_CANCEL_URL ?? 'http://localhost:3000/payment/cancel',
    timeoutMs: Number(env.PAYOS_TIMEOUT_MS ?? 5000),
  };
}

export function redisConfig(env: NodeJS.ProcessEnv = process.env): RedisConfig {
  return {
    host: env.REDIS_HOST ?? 'redis',
    port: Number(env.REDIS_PORT ?? 6379),
    password: env.REDIS_PASSWORD || undefined,
    tls: env.REDIS_TLS === 'true',
    db: Number(env.REDIS_DB ?? 1),
    commandTimeoutMs: Number(env.REDIS_COMMAND_TIMEOUT_MS ?? 200),
    connectTimeoutMs: Number(env.REDIS_CONNECT_TIMEOUT_MS ?? 1000),
  };
}

export function dbLockConfig(
  env: NodeJS.ProcessEnv = process.env,
): DbLockConfig {
  return {
    lockTimeoutMs: Number(env.DB_LOCK_TIMEOUT_MS ?? 1000),
    idleTxTimeoutMs: Number(env.DB_IDLE_TX_TIMEOUT_MS ?? 15000),
  };
}

// BR-20: tổng chờ để được ghi ≤ 3 s (NT.ORDER_HOLD API_Spec §3, §5). Sai thì dừng khởi động
const MAX_WRITE_WAIT_MS = 3000;

export function orderLockConfig(
  env: NodeJS.ProcessEnv = process.env,
): OrderLockConfig {
  const cfg = {
    ttlMs: Number(env.ORDER_LOCK_TTL_MS ?? 10000),
    waitMs: Number(env.ORDER_LOCK_WAIT_MS ?? 2000),
    retryMs: Number(env.ORDER_LOCK_RETRY_MS ?? 50),
  };
  const total = cfg.waitMs + dbLockConfig(env).lockTimeoutMs;
  if (total > MAX_WRITE_WAIT_MS) {
    throw new Error(
      `ORDER_LOCK_WAIT_MS + DB_LOCK_TIMEOUT_MS = ${total} ms, vượt ${MAX_WRITE_WAIT_MS} ms (BR-20)`,
    );
  }
  return cfg;
}

export default (): OrderConfig => {
  assertRequiredEnv();
  return {
    port: Number(process.env.PORT ?? 3004),
    database: databaseConfig(),
    services: servicesConfig(),
    checkout: checkoutConfig(),
    payos: payosConfig(),
    redis: redisConfig(),
    orderLock: orderLockConfig(),
    dbLock: dbLockConfig(),
  };
};
