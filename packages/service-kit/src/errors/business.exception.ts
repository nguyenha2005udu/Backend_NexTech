import { HttpException } from '@nestjs/common';
import { STATUS_CODES } from 'node:http';

// Lỗi nghiệp vụ có mã NT-* (API_Spec §3). AllExceptionsFilter trả đúng status và code đã khai.
// Body giữ shape của exception NestJS (`statusCode`, `message`, `error`) như be/ đang trả
// (api-convention §5): ConflictException('...') → { statusCode: 409, message, error: 'Conflict' }.
export class BusinessException extends HttpException {
  constructor(
    status: number,
    readonly code: string,
    message: string,
  ) {
    super(
      { statusCode: status, message, error: STATUS_CODES[status] ?? 'Error' },
      status,
    );
  }
}
