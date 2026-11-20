import { QueryFailedError } from 'typeorm';
import { isUniqueViolation } from './unique-violation';

// Lỗi pg khi vi phạm unique: code 23505, constraint = tên index (NT.CATALOG API_Spec §6)
const pgError = (code: string, constraint?: string) =>
  new QueryFailedError(
    'INSERT ...',
    [],
    Object.assign(new Error('duplicate key'), { code, constraint }),
  );

describe('isUniqueViolation', () => {
  it('23505 đúng tên index → true', () => {
    expect(
      isUniqueViolation(
        pgError('23505', 'ux_reviews_user_product'),
        'ux_reviews_user_product',
      ),
    ).toBe(true);
  });

  it('23505 nhưng index khác → false (để filter chung xử lý)', () => {
    expect(
      isUniqueViolation(
        pgError('23505', 'ux_alerts_user_product_active'),
        'ux_reviews_user_product',
      ),
    ).toBe(false);
  });

  it('mã lỗi khác (vd 23503 khoá ngoại) → false', () => {
    expect(
      isUniqueViolation(
        pgError('23503', 'ux_reviews_user_product'),
        'ux_reviews_user_product',
      ),
    ).toBe(false);
  });

  it('không phải QueryFailedError → false', () => {
    expect(
      isUniqueViolation(
        Object.assign(new Error('x'), {
          code: '23505',
          constraint: 'ux_reviews_user_product',
        }),
        'ux_reviews_user_product',
      ),
    ).toBe(false);
    expect(isUniqueViolation(undefined, 'ux_reviews_user_product')).toBe(false);
  });
});
