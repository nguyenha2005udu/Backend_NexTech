// Lỗi nội bộ "khoá đơn bận" và ánh xạ Postgres 55P03 (NT.ORDER_HOLD Component_Class_Design §5, §9; BR-20).
// Bên gọi tự đổi sang HTTP: route người dùng/admin → 409 NT-ORD-1012 (lockBusyTo409 ở errors.ts), webhook → 503,
// poll → trả trạng thái đang lưu. Đặt ở database/ để redis/ và database/ không phụ thuộc vòng.
import { QueryFailedError } from 'typeorm';

/** Không lấy được khoá đơn: Redis bận quá ORDER_LOCK_WAIT_MS, hoặc Postgres chờ khoá dòng quá lock_timeout */
export class OrderLockBusyError extends Error {
  constructor(
    readonly orderId?: string,
    readonly source: 'redis' | 'db' = 'redis',
  ) {
    super(`Khoá đơn ${orderId ?? ''} đang bận (${source})`);
    this.name = 'OrderLockBusyError';
  }
}

// SQLSTATE lock_not_available: lệnh chờ khoá quá lock_timeout
const LOCK_NOT_AVAILABLE = '55P03';

export async function mapDbLockError<T>(
  fn: () => Promise<T>,
  orderId?: string,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (
      err instanceof QueryFailedError &&
      (err.driverError as { code?: string } | undefined)?.code ===
        LOCK_NOT_AVAILABLE
    ) {
      throw new OrderLockBusyError(orderId, 'db');
    }
    throw err;
  }
}
