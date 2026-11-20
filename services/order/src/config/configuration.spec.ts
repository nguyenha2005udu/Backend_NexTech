import {
  DB_REQUIRED,
  assertRequiredEnv,
  databaseConfig,
  servicesConfig,
} from './configuration';

// coding-convention §6: thiếu biến bắt buộc thì dừng khởi động và nêu rõ tên biến
describe('assertRequiredEnv', () => {
  const full = {
    DB_HOST: 'postgres',
    DB_USER: 'order_user',
    DB_PASS: 'order_pass',
    DB_NAME: 'order_db',
    IDENTITY_SERVICE_URL: 'http://identity-service:3001',
    CATALOG_SERVICE_URL: 'http://catalog-service:3002',
    PROMOTION_SERVICE_URL: 'http://promotion-service:3003',
  };

  it('đủ biến → không lỗi', () => {
    expect(() => assertRequiredEnv(full)).not.toThrow();
  });

  it('thiếu hoặc rỗng → lỗi, liệt kê đúng tên các biến thiếu', () => {
    expect(() =>
      assertRequiredEnv({ ...full, DB_USER: undefined, DB_PASS: '' }),
    ).toThrow('Thiếu biến môi trường bắt buộc: DB_USER, DB_PASS');
  });

  it('thiếu URL service → lỗi nêu tên biến (architecture §8: URL bắt buộc lấy từ env)', () => {
    expect(() =>
      assertRequiredEnv({ ...full, CATALOG_SERVICE_URL: undefined }),
    ).toThrow('Thiếu biến môi trường bắt buộc: CATALOG_SERVICE_URL');
  });

  it('CLI migration chỉ cần biến database', () => {
    const dbOnly = { DB_HOST: 'h', DB_USER: 'u', DB_PASS: 'p', DB_NAME: 'n' };
    expect(() => assertRequiredEnv(dbOnly, DB_REQUIRED)).not.toThrow();
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

describe('servicesConfig', () => {
  it('đọc 3 URL service', () => {
    expect(
      servicesConfig({
        IDENTITY_SERVICE_URL: 'i',
        CATALOG_SERVICE_URL: 'c',
        PROMOTION_SERVICE_URL: 'p',
      }),
    ).toEqual({ identityUrl: 'i', catalogUrl: 'c', promotionUrl: 'p' });
  });
});
