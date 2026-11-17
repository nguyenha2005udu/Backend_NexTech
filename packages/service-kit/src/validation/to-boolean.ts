import { Transform } from 'class-transformer';

// Chép từ be/src/common/transformers.ts (API_Spec §1, v1.4). Dùng chung cho DTO query của mọi service.
// Query string luôn là chuỗi. KHÔNG dùng @Type(() => Boolean) vì Boolean('false') === true.
// 'true' / true -> true, 'false' / false -> false, giá trị khác giữ nguyên để @IsBoolean báo lỗi.
export function ToBoolean(): PropertyDecorator {
  return Transform(({ value }: { value: unknown }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value;
  });
}
