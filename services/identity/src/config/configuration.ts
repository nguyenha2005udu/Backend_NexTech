// Cấu hình identity-service (NT.IDENTITY API_Spec §4). Lấy từ be/src/config/configuration.ts,
// bỏ `synchronize` (luôn chạy migration — coding-convention §5), bỏ phần của service khác.
// Mới: `cookieSecure` (COOKIE_SECURE), `mail.requireTLS` (MAIL_REQUIRE_TLS).

const REQUIRED = [
  'DB_HOST',
  'DB_USER',
  'DB_PASS',
  'DB_NAME',
  'REDIS_HOST',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
] as const;

export interface IdentityConfig {
  port: number;
  seedDemo: boolean;
  frontendUrl: string | undefined;
  cookieSecure: boolean;
  database: DatabaseConfig;
  jwt: {
    accessSecret: string;
    accessExpiresIn: string | undefined;
    refreshSecret: string;
    refreshExpiresIn: string | undefined;
  };
  redis: {
    host: string;
    port: number;
    password: string | undefined;
    tls: boolean;
  };
  mail: {
    host: string | undefined;
    port: number;
    user: string | undefined;
    pass: string | undefined;
    requireTLS: boolean;
  };
  google: { clientId?: string; clientSecret?: string; callbackUrl?: string };
  facebook: { appId?: string; appSecret?: string; callbackUrl?: string };
}

export interface DatabaseConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  name: string;
  ssl: boolean;
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

export default (): IdentityConfig => {
  assertRequiredEnv();
  const env = process.env;
  return {
    port: Number(env.PORT ?? 3001),
    seedDemo: env.SEED_DEMO === 'true',
    frontendUrl: env.REDIRECT_URI,
    // Thay `NODE_ENV === 'production'` của be/src/users/auth/auth.cookies.ts: chạy HTTP local mà bật
    // secure thì trình duyệt không gửi cookie
    cookieSecure: env.COOKIE_SECURE === 'true',
    database: databaseConfig(env),
    jwt: {
      accessSecret: env.JWT_SECRET!,
      accessExpiresIn: env.JWT_EXPIRES_IN,
      refreshSecret: env.JWT_REFRESH_SECRET!,
      refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
    },
    redis: {
      host: env.REDIS_HOST!,
      port: Number(env.REDIS_PORT ?? 6379),
      password: env.REDIS_PASSWORD,
      tls: env.REDIS_TLS === 'true',
    },
    mail: {
      host: env.MAIL_HOST,
      port: Number(env.MAIL_PORT ?? 587),
      user: env.MAIL_USER,
      pass: env.MAIL_PASS,
      // be/src/config/mail.ts để cứng requireTLS: true; Mailpit không có TLS
      requireTLS: env.MAIL_REQUIRE_TLS ? env.MAIL_REQUIRE_TLS === 'true' : true,
    },
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      callbackUrl: env.GOOGLE_CALLBACK_URL,
    },
    facebook: {
      appId: env.FACEBOOK_APP_ID,
      appSecret: env.FACEBOOK_APP_SECRET,
      callbackUrl: env.FACEBOOK_CALLBACK_URL,
    },
  };
};
