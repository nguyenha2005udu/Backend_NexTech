import { messagingConfig, type MessagingConfig } from '@nextech/service-kit';

// Cấu hình notification-service (NT.NOTIFICATION API_Spec §5). Phần database lấy từ be/src/config/configuration.ts
// (như promotion), bỏ `synchronize` (luôn tắt, chạy migration — coding-convention §5).
// T4.2: IDENTITY_SERVICE_URL, MAIL_* (như identity), RABBITMQ_URL, CONSUMER_* (NT.MESSAGING API_Spec §6).

const REQUIRED = [
  'DB_HOST',
  'DB_USER',
  'DB_PASS',
  'DB_NAME',
  'IDENTITY_SERVICE_URL',
] as const;

export interface NotificationConfig {
  port: number;
  database: {
    host: string;
    port: number;
    username: string;
    password: string;
    name: string;
    ssl: boolean;
  };
  services: { identityUrl: string };
  mail: {
    host?: string;
    port: number;
    user?: string;
    pass?: string;
    requireTLS: boolean;
  };
  messaging: MessagingConfig;
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

/** Chỉ biến database: CLI migration (data-source.ts) không cần URL service */
export const DB_REQUIRED = ['DB_HOST', 'DB_USER', 'DB_PASS', 'DB_NAME'];

export function databaseConfig(
  env: NodeJS.ProcessEnv = process.env,
): NotificationConfig['database'] {
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

export function mailConfig(
  env: NodeJS.ProcessEnv = process.env,
): NotificationConfig['mail'] {
  return {
    host: env.MAIL_HOST,
    port: Number(env.MAIL_PORT ?? 587),
    user: env.MAIL_USER,
    pass: env.MAIL_PASS,
    // Như identity: mặc định bật (Gmail), Mailpit đặt MAIL_REQUIRE_TLS=false
    requireTLS: env.MAIL_REQUIRE_TLS ? env.MAIL_REQUIRE_TLS === 'true' : true,
  };
}

export default (): NotificationConfig => {
  assertRequiredEnv();
  return {
    port: Number(process.env.PORT ?? 3006),
    database: databaseConfig(),
    services: { identityUrl: process.env.IDENTITY_SERVICE_URL! },
    mail: mailConfig(),
    messaging: messagingConfig(),
  };
};
