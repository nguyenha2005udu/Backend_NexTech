import {
  DB_REQUIRED,
  aiConfig,
  assertRequiredEnv,
  databaseConfig,
} from './configuration';

// coding-convention §6: thiếu biến bắt buộc thì dừng khởi động và nêu rõ tên biến
describe('assertRequiredEnv', () => {
  const full = {
    DB_HOST: 'postgres',
    DB_USER: 'assistant_user',
    DB_PASS: 'assistant_pass',
    DB_NAME: 'assistant_db',
    CATALOG_SERVICE_URL: 'http://catalog-service:3002',
    IDENTITY_SERVICE_URL: 'http://identity-service:3001',
    FPT_BASE_URL: 'http://ai-mock:4020',
  };

  it('đủ biến → không lỗi; FPT_KEY không bắt buộc', () => {
    expect(() => assertRequiredEnv(full)).not.toThrow();
  });

  it('thiếu hoặc rỗng → lỗi, liệt kê đúng tên các biến thiếu', () => {
    expect(() =>
      assertRequiredEnv({ ...full, DB_USER: undefined, FPT_BASE_URL: '' }),
    ).toThrow('Thiếu biến môi trường bắt buộc: DB_USER, FPT_BASE_URL');
  });

  it('CLI migration chỉ cần biến DB', () => {
    const db = {
      DB_HOST: 'h',
      DB_USER: 'u',
      DB_PASS: 'p',
      DB_NAME: 'n',
    };
    expect(() => assertRequiredEnv(db, DB_REQUIRED)).not.toThrow();
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

// design/ASSISTANT/README.md §4
describe('aiConfig', () => {
  it('mặc định: model DeepSeek-V4-Flash, 30s mỗi lần gọi, ngân sách 75s, giữ facets 5 phút', () => {
    expect(aiConfig({ FPT_BASE_URL: 'http://ai-mock:4020' })).toEqual({
      baseUrl: 'http://ai-mock:4020',
      key: '',
      model: 'DeepSeek-V4-Flash',
      callTimeoutMs: 30000,
      budgetMs: 75000,
      contextTtlMs: 300000,
    });
  });

  it('đọc FPT_KEY, FPT_MODEL, AI_* từ env', () => {
    const ai = aiConfig({
      FPT_BASE_URL: 'https://mkp-api.fptcloud.com',
      FPT_KEY: 'k',
      FPT_MODEL: 'm',
      AI_CALL_TIMEOUT_MS: '1000',
      AI_BUDGET_MS: '2000',
      AI_CONTEXT_TTL_MS: '3000',
    });
    expect(ai).toMatchObject({
      key: 'k',
      model: 'm',
      callTimeoutMs: 1000,
      budgetMs: 2000,
      contextTtlMs: 3000,
    });
  });
});
