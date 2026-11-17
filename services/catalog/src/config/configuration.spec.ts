import { assertRequiredEnv } from './configuration';

// coding-convention §6: thiếu biến bắt buộc thì dừng khởi động và nêu rõ tên biến
describe('assertRequiredEnv', () => {
  const full = {
    DB_HOST: 'postgres',
    DB_USER: 'catalog_user',
    DB_PASS: 'catalog_pass',
    DB_NAME: 'catalog_db',
  };

  it('đủ biến → không lỗi', () => {
    expect(() => assertRequiredEnv(full)).not.toThrow();
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
