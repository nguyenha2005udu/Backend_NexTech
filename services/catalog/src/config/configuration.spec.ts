import { assertRequiredEnv, servicesConfig } from './configuration';

// coding-convention §6: thiếu biến bắt buộc thì dừng khởi động và nêu rõ tên biến
describe('assertRequiredEnv', () => {
  const full = {
    DB_HOST: 'postgres',
    DB_USER: 'catalog_user',
    DB_PASS: 'catalog_pass',
    DB_NAME: 'catalog_db',
    ORDER_SERVICE_URL: 'http://order-service:3004',
    IDENTITY_SERVICE_URL: 'http://identity-service:3001',
  };

  it('đủ biến → không lỗi', () => {
    expect(() => assertRequiredEnv(full)).not.toThrow();
  });

  // architecture §8: địa chỉ service bắt buộc lấy từ env (T2.5)
  it('thiếu ORDER_SERVICE_URL, IDENTITY_SERVICE_URL → lỗi nêu đúng tên', () => {
    expect(() =>
      assertRequiredEnv({
        ...full,
        ORDER_SERVICE_URL: undefined,
        IDENTITY_SERVICE_URL: '',
      }),
    ).toThrow(
      'Thiếu biến môi trường bắt buộc: ORDER_SERVICE_URL, IDENTITY_SERVICE_URL',
    );
  });

  it('thiếu hoặc rỗng → lỗi, liệt kê đúng tên các biến thiếu', () => {
    expect(() =>
      assertRequiredEnv({ ...full, DB_USER: undefined, DB_PASS: '' }),
    ).toThrow('Thiếu biến môi trường bắt buộc: DB_USER, DB_PASS');
  });

  it('Cloudinary không bắt buộc: thiếu CLOUDINARY_* vẫn khởi động (để disabled)', () => {
    expect(() => assertRequiredEnv(full)).not.toThrow();
    expect(full).not.toHaveProperty('CLOUDINARY_CLOUD_NAME');
  });
});

describe('servicesConfig', () => {
  it('đọc URL order, identity và lịch cron theo dõi giá', () => {
    expect(
      servicesConfig({
        ORDER_SERVICE_URL: 'http://o:3004',
        IDENTITY_SERVICE_URL: 'http://i:3001',
        PRICE_ALERT_CRON: '* * * * *',
      }),
    ).toEqual({
      orderUrl: 'http://o:3004',
      identityUrl: 'http://i:3001',
      priceAlertCron: '* * * * *',
    });
  });

  it('PRICE_ALERT_CRON mặc định mỗi 10 phút (NT.CATALOG API_Spec §5)', () => {
    expect(servicesConfig({}).priceAlertCron).toBe('*/10 * * * *');
  });
});
