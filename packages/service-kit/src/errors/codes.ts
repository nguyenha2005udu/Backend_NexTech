// Mã lỗi dùng chung (standards/api-convention.md §6).
export const GEN_ERROR = {
  INVALID_INPUT: 'NT-GEN-0001',
  UNAUTHORIZED: 'NT-GEN-0002',
  FORBIDDEN: 'NT-GEN-0003',
  NOT_FOUND: 'NT-GEN-0004',
  CONFLICT: 'NT-GEN-0005',
  INTERNAL: 'NT-GEN-0500',
  UPSTREAM_UNAVAILABLE: 'NT-GEN-0503',
  UPSTREAM_TIMEOUT: 'NT-GEN-0504',
} as const;

// Bảng api-convention §6
const CODE_BY_STATUS: Record<number, string> = {
  400: GEN_ERROR.INVALID_INPUT,
  401: GEN_ERROR.UNAUTHORIZED,
  403: GEN_ERROR.FORBIDDEN,
  404: GEN_ERROR.NOT_FOUND,
  409: GEN_ERROR.CONFLICT,
  500: GEN_ERROR.INTERNAL,
  503: GEN_ERROR.UPSTREAM_UNAVAILABLE,
  504: GEN_ERROR.UPSTREAM_TIMEOUT,
};

// Status không có trong bảng: 5xx -> NT-GEN-0500, 4xx khác -> NT-GEN-0001 [cần xác nhận].
// Export (NT.SERVICE_KIT v1.5): filter dùng khi lỗi không có mã riêng; saga order lưu failure_code trùng mã client nhận.
export function codeForStatus(status: number): string {
  return (
    CODE_BY_STATUS[status] ??
    (status >= 500 ? GEN_ERROR.INTERNAL : GEN_ERROR.INVALID_INPUT)
  );
}
