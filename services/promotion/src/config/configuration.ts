// Cấu hình promotion-service (NT.PROMOTION API_Spec §4). Phần database lấy từ be/src/config/configuration.ts,
// bỏ `synchronize` (luôn tắt, chạy migration — coding-convention §5).

const REQUIRED = ['DB_HOST', 'DB_USER', 'DB_PASS', 'DB_NAME'] as const;

export interface PromotionConfig {
  port: number;
  seedDemo: boolean;
  database: {
    host: string;
    port: number;
    username: string;
    password: string;
    name: string;
    ssl: boolean;
  };
}

// Thiếu biến bắt buộc thì dừng khởi động, báo rõ tên biến (coding-convention §6)
export function assertRequiredEnv(env: NodeJS.ProcessEnv = process.env): void {
  const missing = REQUIRED.filter((k) => !env[k]);
  if (missing.length) {
    throw new Error(`Thiếu biến môi trường bắt buộc: ${missing.join(', ')}`);
  }
}

export function databaseConfig(
  env: NodeJS.ProcessEnv = process.env,
): PromotionConfig['database'] {
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

export default (): PromotionConfig => {
  assertRequiredEnv();
  return {
    port: Number(process.env.PORT ?? 3003),
    seedDemo: process.env.SEED_DEMO === 'true',
    database: databaseConfig(),
  };
};
