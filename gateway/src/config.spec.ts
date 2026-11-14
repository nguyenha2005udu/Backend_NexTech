import { loadConfig } from './config';

const REQUIRED = {
  JWT_SECRET: 's',
  INTERNAL_API_TOKEN: 't',
  IDENTITY_SERVICE_URL: 'http://identity-service:3001',
  CATALOG_SERVICE_URL: 'http://catalog-service:3002',
  PROMOTION_SERVICE_URL: 'http://promotion-service:3003',
  ORDER_SERVICE_URL: 'http://order-service:3004',
  NOTIFICATION_SERVICE_URL: 'http://notification-service:3006',
  ASSISTANT_SERVICE_URL: 'http://assistant-service:3007',
};

describe('loadConfig', () => {
  it('thiếu biến bắt buộc thì ném lỗi liệt kê đủ tên biến', () => {
    const env = { ...REQUIRED, JWT_SECRET: '', ORDER_SERVICE_URL: undefined };
    expect(() => loadConfig(env)).toThrow(/JWT_SECRET.*ORDER_SERVICE_URL/);
  });

  it('dùng giá trị mặc định theo API_Spec §6', () => {
    const c = loadConfig(REQUIRED);
    expect(c).toMatchObject({
      port: 8080,
      jwtSecret: 's',
      internalToken: 't',
      corsOrigins: ['http://localhost:3000'],
      cookieSecure: false,
      proxyTimeoutMs: 10000,
      proxyTimeoutAiMs: 80000,
      httpTimeoutMs: 2000,
      rateLimitPerMin: 600,
      rateLimitAuthPerMin: 30,
      rateLimitAiPerMin: 20,
    });
    expect(c.serviceUrls.order).toBe('http://order-service:3004');
    expect(c.serviceUrls.assistant).toBe('http://assistant-service:3007');
  });

  it('đọc giá trị ghi đè, CORS_ORIGINS tách bằng dấu phẩy', () => {
    const c = loadConfig({
      ...REQUIRED,
      PORT: '9000',
      CORS_ORIGINS: 'http://a.local, http://b.local',
      COOKIE_SECURE: 'true',
      RATE_LIMIT_PER_MIN: '0',
    });
    expect(c.port).toBe(9000);
    expect(c.corsOrigins).toEqual(['http://a.local', 'http://b.local']);
    expect(c.cookieSecure).toBe(true);
    expect(c.rateLimitPerMin).toBe(0);
  });
});
