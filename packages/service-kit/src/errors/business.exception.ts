import { HttpException } from '@nestjs/common';

// Lỗi nghiệp vụ có mã NT-* (API_Spec §3). AllExceptionsFilter trả đúng status và code đã khai.
export class BusinessException extends HttpException {
  constructor(
    status: number,
    readonly code: string,
    message: string,
  ) {
    super(message, status);
  }
}
