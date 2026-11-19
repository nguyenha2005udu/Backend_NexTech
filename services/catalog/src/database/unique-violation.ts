import { QueryFailedError } from 'typeorm';

// Vi phạm unique (23505) đúng index `constraint` (NT.CATALOG API_Spec §6, Component_Class_Design §1).
// Hai request đồng thời cùng vượt bước kiểm tra đọc thì index chặn ở DB; bên gọi đổi lỗi này thành
// đúng mã như nhánh kiểm tra thường (ux_reviews_user_product → NT-CAT-1007, ux_alerts_user_product_active
// → NT-CAT-1008). Lỗi khác để AllExceptionsFilter của service-kit xử lý chung.
export function isUniqueViolation(err: unknown, constraint: string): boolean {
  if (!(err instanceof QueryFailedError)) return false;
  const driver = err.driverError as { code?: string; constraint?: string };
  return driver?.code === '23505' && driver.constraint === constraint;
}
