// Cấu hình catalog-service (NT.CATALOG API_Spec §5). Lấy phần DB, Cloudinary từ be/src/config/configuration.ts,
// bỏ `synchronize` (luôn chạy migration — coding-convention §5), bỏ phần của service khác.
// ORDER/IDENTITY_SERVICE_URL, PRICE_ALERT_CRON thêm ở T2.5; RABBITMQ_URL ở T4.1.

// URL service bắt buộc lấy từ env (architecture §8), thiếu thì dừng khởi động
const REQUIRED = [
  'DB_HOST',
  'DB_USER',
  'DB_PASS',
  'DB_NAME',
  'ORDER_SERVICE_URL',
  'IDENTITY_SERVICE_URL',
] as const;

export interface CatalogConfig {
  port: number;
  seedDemo: boolean;
  database: DatabaseConfig;
  cloudinary: CloudinaryConfig;
  services: ServicesConfig;
}

export interface ServicesConfig {
  /** order-service: hỏi đã mua chưa khi tạo đánh giá (BR-11) */
  orderUrl: string;
  /** identity-service: snapshot tên người đánh giá */
  identityUrl: string;
  /** Lịch cron theo dõi giá (BR-12), cú pháp cron 5 trường */
  priceAlertCron: string;
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

export function servicesConfig(
  env: NodeJS.ProcessEnv = process.env,
): ServicesConfig {
  return {
    orderUrl: env.ORDER_SERVICE_URL!,
    identityUrl: env.IDENTITY_SERVICE_URL!,
    // NT.CATALOG API_Spec §5: mặc định 10 phút như be/ (CronExpression.EVERY_10_MINUTES); demo đặt 1 phút
    priceAlertCron: env.PRICE_ALERT_CRON || '*/10 * * * *',
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
    services: servicesConfig(env),
  };
};
