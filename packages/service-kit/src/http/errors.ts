import { HttpException } from '@nestjs/common';
import { GEN_ERROR } from '../errors/codes';

export type UpstreamOutcome = 'not_executed' | 'unknown';

// Service phụ thuộc lỗi hạ tầng: 503 hoặc 504 (reliability-standard §4).
// `outcome` cho saga biết lời gọi chắc chắn chưa tới đích hay không rõ.
export class UpstreamError extends HttpException {
  readonly code: string;

  constructor(
    readonly target: string,
    readonly reason: string,
    public outcome: UpstreamOutcome,
    status: 503 | 504 = 503,
  ) {
    // Message không chứa địa chỉ nội bộ
    super(
      status === 504
        ? `Service ${target} quá thời gian chờ`
        : `Service ${target} không sẵn sàng`,
      status,
    );
    this.code =
      status === 504
        ? GEN_ERROR.UPSTREAM_TIMEOUT
        : GEN_ERROR.UPSTREAM_UNAVAILABLE;
  }
}

// Service phụ thuộc trả 4xx: giữ nguyên status, mã và message để chuyển về client.
export class UpstreamBusinessError extends HttpException {
  constructor(
    readonly target: string,
    status: number,
    readonly upstreamCode: string | undefined,
    message: string | string[],
  ) {
    super(message, status);
  }
}
