// Cấu hình order-service (NT.ORDER API_Spec §4). Khung T1.6: database. T3.1: URL 3 service.
// Phần database lấy từ be/src/config/configuration.ts (như promotion), bỏ `synchronize`
// (luôn tắt, chạy migration — coding-convention §5). Biến của nghiệp vụ thêm khi có code dùng:
// SHIPPING_*, SAGA_* ở T3.3; PAYOS_* ở T3.6; REDIS_*, ORDER_HOLD_*, ORDER_LOCK_* ở T3.9–T3.10.

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

export default (): OrderConfig => {
  assertRequiredEnv();
  return {
    port: Number(process.env.PORT ?? 3004),
    database: databaseConfig(),
    services: servicesConfig(),
  };
};
