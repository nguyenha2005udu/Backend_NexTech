// Cấu hình catalog-service (NT.CATALOG API_Spec §5). Lấy phần DB, Cloudinary từ be/src/config/configuration.ts,
// bỏ `synchronize` (luôn chạy migration — coding-convention §5), bỏ phần của service khác.
// ORDER/IDENTITY_SERVICE_URL, PRICE_ALERT_CRON, RABBITMQ_URL thêm ở T2.5, T4.1 khi có code dùng.

const REQUIRED = ['DB_HOST', 'DB_USER', 'DB_PASS', 'DB_NAME'] as const;

export interface CatalogConfig {
  port: number;
  seedDemo: boolean;
  database: DatabaseConfig;
  cloudinary: CloudinaryConfig;
}

export interface DatabaseConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  name: string;
  ssl: boolean;
}

export interface CloudinaryConfig {
  cloudName: string | undefined;
  apiKey: string | undefined;
  apiSecret: string | undefined;
  /** Timeout mỗi lời gọi Cloudinary (Component_Class_Design §2: 5 giây) */
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
): DatabaseConfig {
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

export function cloudinaryConfig(
  env: NodeJS.ProcessEnv = process.env,
): CloudinaryConfig {
  return {
    // Không có key thật thì để `disabled`: khởi động bình thường, upload file trả 503 (API_Spec §5)
    cloudName: env.CLOUDINARY_CLOUD_NAME,
    apiKey: env.CLOUDINARY_API_KEY,
    apiSecret: env.CLOUDINARY_API_SECRET,
    timeoutMs: 5000,
  };
}

export default (): CatalogConfig => {
  assertRequiredEnv();
  const env = process.env;
  return {
    port: Number(env.PORT ?? 3002),
    seedDemo: env.SEED_DEMO === 'true',
    database: databaseConfig(env),
    cloudinary: cloudinaryConfig(env),
  };
};
