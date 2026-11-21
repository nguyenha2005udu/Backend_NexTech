import {
  DB_REQUIRED,
  assertRequiredEnv,
  checkoutConfig,
  payosConfig,
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

// NT.ORDER API_Spec §4, NT.CHECKOUT_SAGA API_Spec §5: có mặc định, không bắt buộc
describe('checkoutConfig', () => {
  it('không đặt biến → mặc định 30000, 500000, 8000, 120000, 10000, bật resilience', () => {
    expect(checkoutConfig({})).toEqual({
      shippingFee: 30000,
      freeShippingThreshold: 500000,
      budgetMs: 8000,
      deadlineMs: 120000,
      reconcileIntervalMs: 10000,
      resilienceEnabled: true,
    });
  });

  it('đọc biến thành số', () => {
    expect(
      checkoutConfig({
        SHIPPING_FEE: '15000',
        FREE_SHIPPING_THRESHOLD: '100000',
        SAGA_BUDGET_MS: '3000',
        SAGA_DEADLINE_MS: '60000',
        SAGA_RECONCILE_INTERVAL_MS: '5000',
      }),
    ).toEqual({
      shippingFee: 15000,
      freeShippingThreshold: 100000,
      budgetMs: 3000,
      deadlineMs: 60000,
      reconcileIntervalMs: 5000,
      resilienceEnabled: true,
    });
  });

  // RESILIENCE_ENABLED=false: đo baseline "chưa xử lý" — cron đối soát tắt (Component_Class_Design §7)
  it('RESILIENCE_ENABLED=false → resilienceEnabled false; giá trị khác vẫn bật', () => {
    expect(
      checkoutConfig({ RESILIENCE_ENABLED: 'false' }).resilienceEnabled,
    ).toBe(false);
    expect(
      checkoutConfig({ RESILIENCE_ENABLED: 'true' }).resilienceEnabled,
    ).toBe(true);
  });
});

// NT.PAYMENT API_Spec §5. PAYOS_BASE_URL không đọc ở đây: SDK tự đọc (compose mặc định mock, v2.7)
describe('payosConfig', () => {
  it('không đặt biến → mặc định dev, timeout 5000', () => {
    expect(payosConfig({})).toEqual({
      clientId: 'dev',
      apiKey: 'dev',
      checksumKey: 'dev-checksum',
      returnUrl: 'http://localhost:3000/payment/success',
      cancelUrl: 'http://localhost:3000/payment/cancel',
      timeoutMs: 5000,
    });
  });

  it('đọc biến, timeout thành số', () => {
    expect(
      payosConfig({
        PAYOS_CLIENT_ID: 'c',
        PAYOS_API_KEY: 'k',
        PAYOS_CHECKSUM_KEY: 's',
        PAYOS_RETURN_URL: 'r',
        PAYOS_CANCEL_URL: 'x',
        PAYOS_TIMEOUT_MS: '1500',
      }),
    ).toEqual({
      clientId: 'c',
      apiKey: 'k',
      checksumKey: 's',
      returnUrl: 'r',
      cancelUrl: 'x',
      timeoutMs: 1500,
    });
  });
});
