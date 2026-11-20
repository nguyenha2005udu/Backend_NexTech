import { QueryFailedError } from 'typeorm';

// Chép từ services/catalog/src/database/unique-violation.ts (T2.5): cấm import chéo service, chưa có
// trong service-kit (trùng 2 service: tech-debt T3.3). Vi phạm unique (23505) đúng index `constraint`.
// Checkout đổi ux_orders_idempotency → trả đơn cũ, ux_orders_cart_processing → 409 NT-ORD-1009
// (NT.CHECKOUT_SAGA API_Spec §1). Lỗi khác để AllExceptionsFilter của service-kit xử lý chung.
export function isUniqueViolation(err: unknown, constraint: string): boolean {
  if (!(err instanceof QueryFailedError)) return false;
  const driver = err.driverError as { code?: string; constraint?: string };
  return driver?.code === '23505' && driver.constraint === constraint;
}
