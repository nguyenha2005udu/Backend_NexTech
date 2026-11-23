import { QueryFailedError } from 'typeorm';
import { OrderLockBusyError, mapDbLockError } from './db-lock-error';

// NT.ORDER_HOLD Component_Class_Design §9: Postgres 55P03 (lock_not_available, do lock_timeout) → OrderLockBusyError.
// Lỗi khác ném nguyên. Ca 55P03 thật trên Postgres: redis/order-lock.service.int-spec.ts (#6).

const dbError = (code: string) =>
  new QueryFailedError(
    'SELECT 1 FOR UPDATE',
    [],
    Object.assign(new Error('x'), { code }),
  );

describe('mapDbLockError', () => {
  it('trả kết quả của fn khi không lỗi', async () => {
    await expect(mapDbLockError(() => Promise.resolve(42))).resolves.toBe(42);
  });

  it('55P03 → OrderLockBusyError', async () => {
    const err = await mapDbLockError(() =>
      Promise.reject(dbError('55P03')),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OrderLockBusyError);
  });

  it('SQLSTATE khác (23505) ném nguyên', async () => {
    const original = dbError('23505');
    await expect(mapDbLockError(() => Promise.reject(original))).rejects.toBe(
      original,
    );
  });

  it('lỗi không phải QueryFailedError ném nguyên', async () => {
    const original = new Error('khác');
    await expect(mapDbLockError(() => Promise.reject(original))).rejects.toBe(
      original,
    );
  });
});
