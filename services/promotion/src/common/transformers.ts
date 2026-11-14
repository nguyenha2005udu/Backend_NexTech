// Chép từ be/src/common/transformers.ts, chỉ thêm kiểu `unknown` cho value để qua lint (Reuse Report T2.1: trùng ở service thứ hai thì đưa vào service-kit).
import { Transform } from 'class-transformer';

// Query string luôn là chuỗi. KHÔNG dùng @Type(() => Boolean) vì Boolean('false') === true.
// 'true' / true -> true, 'false' / false -> false, giá trị khác giữ nguyên để @IsBoolean báo lỗi.
export function ToBoolean() {
  return Transform(({ value }: { value: unknown }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value;
  });
}
