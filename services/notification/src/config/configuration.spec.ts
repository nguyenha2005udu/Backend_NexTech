import { assertRequiredEnv, databaseConfig, mailConfig } from './configuration';

// coding-convention §6: thiếu biến bắt buộc thì dừng khởi động và nêu rõ tên biến
describe('assertRequiredEnv', () => {
  const full = {
    DB_HOST: 'postgres',
    DB_USER: 'notification_user',
    DB_PASS: 'notification_pass',
    DB_NAME: 'notification_db',
    IDENTITY_SERVICE_URL: 'http://identity-service:3001',
  };

  it('đủ biến → không lỗi', () => {
    expect(() => assertRequiredEnv(full)).not.toThrow();
  });

  it('thiếu hoặc rỗng → lỗi, liệt kê đúng tên các biến thiếu', () => {
    expect(() =>
      assertRequiredEnv({ ...full, DB_USER: undefined, DB_PASS: '' }),
    ).toThrow('Thiếu biến môi trường bắt buộc: DB_USER, DB_PASS');
  });

  it('thiếu IDENTITY_SERVICE_URL → lỗi (T4.2: lấy email người nhận)', () => {
    expect(() =>
      assertRequiredEnv({ ...full, IDENTITY_SERVICE_URL: undefined }),
    ).toThrow('IDENTITY_SERVICE_URL');
  });
});

describe('mailConfig', () => {
  it('mặc định requireTLS bật, cổng 587; MAIL_REQUIRE_TLS=false tắt (Mailpit)', () => {
    expect(mailConfig({})).toMatchObject({ port: 587, requireTLS: true });
    expect(
      mailConfig({ MAIL_REQUIRE_TLS: 'false', MAIL_PORT: '1025' }),
    ).toMatchObject({ port: 1025, requireTLS: false });
  });
});

// Giống be/src/config/configuration.ts: mặc định bật SSL (DB cloud), Postgres local đặt DB_SSL=false
describe('databaseConfig', () => {
  const env = { DB_HOST: 'h', DB_USER: 'u', DB_PASS: 'p', DB_NAME: 'n' };

  it('không đặt DB_SSL, DB_PORT → ssl bật, cổng 5432', () => {
    expect(databaseConfig(env)).toEqual({
      host: 'h',
      port: 5432,
      username: 'u',
      password: 'p',
      name: 'n',
      ssl: true,
    });
  });

  it('DB_SSL=false → tắt ssl; DB_PORT đọc thành số', () => {
    const db = databaseConfig({ ...env, DB_SSL: 'false', DB_PORT: '5433' });
    expect(db.ssl).toBe(false);
    expect(db.port).toBe(5433);
  });
});
