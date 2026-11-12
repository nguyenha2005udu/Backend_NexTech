import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { QueryFailedError } from 'typeorm';
import { currentRequestId } from '../context/request-context';
import { UpstreamBusinessError, UpstreamError } from '../http/errors';
import { BusinessException } from './business.exception';
import { GEN_ERROR } from './codes';

// Lỗi Postgres do input của client -> 4xx thay vì 500.
// Chép từ be/src/common/query-failed.filter.ts, thêm mã NT-GEN-*.
const PG_ERRORS: Record<
  string,
  { status: number; code: string; message: string }
> = {
  '22P02': {
    status: HttpStatus.BAD_REQUEST,
    code: GEN_ERROR.INVALID_INPUT,
    message: 'Dữ liệu không hợp lệ (sai định dạng id?)',
  },
  '23505': {
    status: HttpStatus.CONFLICT,
    code: GEN_ERROR.CONFLICT,
    message: 'Dữ liệu đã tồn tại',
  },
  '23503': {
    status: HttpStatus.CONFLICT,
    code: GEN_ERROR.CONFLICT,
    message: 'Dữ liệu đang được tham chiếu bởi bản ghi khác',
  },
};

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

// Status không có trong bảng: 5xx -> NT-GEN-0500, 4xx khác -> NT-GEN-0001 [cần xác nhận]
function codeForStatus(status: number): string {
  return (
    CODE_BY_STATUS[status] ??
    (status >= 500 ? GEN_ERROR.INTERNAL : GEN_ERROR.INVALID_INPUT)
  );
}

type ErrorBody = Record<string, unknown> & { statusCode: number };

// Định dạng mọi lỗi theo api-convention §5: giữ trường NestJS, thêm `code`, `request_id`.
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const req = http.getRequest<Request>();
    const incoming = req.headers?.['x-request-id'];
    const requestId =
      currentRequestId() ??
      (typeof incoming === 'string' ? incoming : undefined);

    const { body, code } = this.toBody(exception);
    res.status(body.statusCode).json({ ...body, code, request_id: requestId });
  }

  private toBody(exception: unknown): { body: ErrorBody; code: string } {
    if (exception instanceof UpstreamBusinessError) {
      const status = exception.getStatus();
      return {
        body: this.nestBody(exception),
        code: exception.upstreamCode ?? codeForStatus(status),
      };
    }
    if (exception instanceof UpstreamError) {
      this.logger.warn(
        `Upstream ${exception.target} lỗi: ${exception.reason} (${exception.outcome})`,
      );
      return { body: this.nestBody(exception), code: exception.code };
    }
    if (exception instanceof BusinessException) {
      return { body: this.nestBody(exception), code: exception.code };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status >= 500) this.logger.error(exception.message, exception.stack);
      return { body: this.nestBody(exception), code: codeForStatus(status) };
    }
    if (exception instanceof QueryFailedError) {
      const pgCode = (exception.driverError as { code?: string } | undefined)
        ?.code;
      const mapped = pgCode ? PG_ERRORS[pgCode] : undefined;
      if (mapped) {
        return {
          body: { statusCode: mapped.status, message: mapped.message },
          code: mapped.code,
        };
      }
    }

    // Không trả câu SQL / chi tiết lỗi ra client, chỉ ghi log
    const err = exception as Error | undefined;
    this.logger.error(err?.message, err?.stack);
    return {
      body: {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Internal server error',
      },
      code: GEN_ERROR.INTERNAL,
    };
  }

  // Body mặc định của NestJS cho HttpException
  private nestBody(exception: HttpException): ErrorBody {
    const status = exception.getStatus();
    const response = exception.getResponse();
    if (typeof response === 'object' && response !== null) {
      return { ...(response as Record<string, unknown>), statusCode: status };
    }
    return { statusCode: status, message: response };
  }
}
