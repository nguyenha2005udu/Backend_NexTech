import type { Request, Response } from 'express';

// Mã lỗi của gateway (NT.GATEWAY API_Spec §4). Body theo api-convention §5.
export const GW_ERROR = {
  UNAUTHORIZED: 'NT-GW-0401',
  FORBIDDEN: 'NT-GW-0003',
  NOT_FOUND: 'NT-GW-0404',
  RATE_LIMITED: 'NT-GW-0429',
  UPSTREAM_UNAVAILABLE: 'NT-GW-0503',
  UPSTREAM_TIMEOUT: 'NT-GW-0504',
} as const;
export type GwErrorCode = (typeof GW_ERROR)[keyof typeof GW_ERROR];

const ERRORS: Record<
  GwErrorCode,
  { status: number; error: string; message: string }
> = {
  'NT-GW-0401': {
    status: 401,
    error: 'Unauthorized',
    message: 'Chưa đăng nhập hoặc phiên đăng nhập đã hết hạn',
  },
  'NT-GW-0003': { status: 403, error: 'Forbidden', message: 'Không đủ quyền' },
  'NT-GW-0404': {
    status: 404,
    error: 'Not Found',
    message: 'Không tìm thấy đường dẫn',
  },
  'NT-GW-0429': {
    status: 429,
    error: 'Too Many Requests',
    message: 'Gọi quá nhanh, vui lòng thử lại sau',
  },
  'NT-GW-0503': {
    status: 503,
    error: 'Service Unavailable',
    message: 'Dịch vụ tạm thời không sẵn sàng',
  },
  'NT-GW-0504': {
    status: 504,
    error: 'Gateway Timeout',
    message: 'Dịch vụ quá thời gian chờ',
  },
};

export function sendError(
  req: Request,
  res: Response,
  code: GwErrorCode,
): void {
  const e = ERRORS[code];
  // Không lộ tên hay địa chỉ service nội bộ trong message
  res.status(e.status).json({
    statusCode: e.status,
    code,
    message: e.message,
    error: e.error,
    request_id: req.requestId,
  });
}
