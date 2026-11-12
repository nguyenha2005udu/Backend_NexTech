import {
  ArgumentsHost,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { BusinessException } from './business.exception';
import { UpstreamBusinessError, UpstreamError } from '../http/errors';

function run(exception: unknown, headers: Record<string, string> = {}) {
  const out: { status?: number; body?: Record<string, unknown> } = {};
  const res = {
    status(code: number) {
      out.status = code;
      return this;
    },
    json(body: Record<string, unknown>) {
      out.body = body;
      return this;
    },
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => res,
      getRequest: () => ({ headers }),
    }),
  } as unknown as ArgumentsHost;
  new AllExceptionsFilter().catch(exception, host);
  return out as { status: number; body: Record<string, unknown> };
}

const pgError = (code: string) =>
  new QueryFailedError(
    'SELECT 1',
    [],
    Object.assign(new Error('pg'), { code }),
  );

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});

describe('AllExceptionsFilter', () => {
  it('BusinessException: status và code đã khai, có request_id', () => {
    const r = run(new BusinessException(409, 'NT-CAT-1001', 'Hết hàng'), {
      'x-request-id': 'rid-1',
    });

    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({
      statusCode: 409,
      code: 'NT-CAT-1001',
      message: 'Hết hàng',
      request_id: 'rid-1',
    });
  });

  it('UpstreamBusinessError: giữ status, mã và message của service đích', () => {
    const r = run(
      new UpstreamBusinessError('catalog', 409, 'NT-CAT-1001', 'Hết hàng'),
    );

    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: 'NT-CAT-1001', message: 'Hết hàng' });
  });

  it('UpstreamBusinessError không có mã: suy theo status', () => {
    const r = run(
      new UpstreamBusinessError('catalog', 404, undefined, 'Không thấy'),
    );

    expect(r.body.code).toBe('NT-GEN-0004');
  });

  it('UpstreamError: 503/504 với NT-GEN-0503/0504, không lộ địa chỉ nội bộ', () => {
    const r503 = run(
      new UpstreamError('catalog', 'ECONNREFUSED', 'not_executed', 503),
    );
    const r504 = run(new UpstreamError('catalog', 'timeout', 'unknown', 504));

    expect(r503.status).toBe(503);
    expect(r503.body.code).toBe('NT-GEN-0503');
    expect(r504.status).toBe(504);
    expect(r504.body.code).toBe('NT-GEN-0504');
    expect(JSON.stringify(r503.body)).not.toMatch(/http:|ECONNREFUSED|:300\d/);
  });

  it('HttpException khác: giữ body NestJS, code suy theo bảng api-convention §6', () => {
    expect(run(new ForbiddenException()).body).toMatchObject({
      statusCode: 403,
      code: 'NT-GEN-0003',
      message: 'Forbidden',
    });
    expect(run(new NotFoundException('Không tìm thấy đơn')).body).toMatchObject(
      {
        statusCode: 404,
        code: 'NT-GEN-0004',
        message: 'Không tìm thấy đơn',
        error: 'Not Found',
      },
    );
    expect(run(new ConflictException('Trùng')).body.code).toBe('NT-GEN-0005');
    expect(run(new HttpException('Lỗi', 500)).body.code).toBe('NT-GEN-0500');
  });

  it('lỗi validate: giữ message dạng mảng, code NT-GEN-0001', () => {
    const r = run(new BadRequestException(['email must be an email']));

    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({
      code: 'NT-GEN-0001',
      message: ['email must be an email'],
      error: 'Bad Request',
    });
  });

  it('QueryFailedError 22P02: 400 NT-GEN-0001, câu chữ như monolith', () => {
    const r = run(pgError('22P02'));

    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({
      statusCode: 400,
      code: 'NT-GEN-0001',
      message: 'Dữ liệu không hợp lệ (sai định dạng id?)',
    });
  });

  it('QueryFailedError 23505, 23503: 409 NT-GEN-0005', () => {
    expect(run(pgError('23505')).body).toMatchObject({
      statusCode: 409,
      code: 'NT-GEN-0005',
      message: 'Dữ liệu đã tồn tại',
    });
    expect(run(pgError('23503')).body).toMatchObject({
      statusCode: 409,
      code: 'NT-GEN-0005',
      message: 'Dữ liệu đang được tham chiếu bởi bản ghi khác',
    });
  });

  it('lỗi khác và QueryFailedError lạ: 500 NT-GEN-0500, không lộ chi tiết', () => {
    const r = run(new Error('password=secret ở dòng SQL'));
    const rPg = run(pgError('99999'));

    for (const x of [r, rPg]) {
      expect(x.status).toBe(500);
      expect(x.body).toMatchObject({
        statusCode: 500,
        code: 'NT-GEN-0500',
        message: 'Internal server error',
      });
      expect(JSON.stringify(x.body)).not.toMatch(/secret|SELECT/);
    }
  });
});
