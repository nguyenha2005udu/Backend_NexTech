import type { NextFunction, Request, Response } from 'express';
import { currentRequestId, requestContextMiddleware } from './request-context';

function fakeReqRes(headers: Record<string, string> = {}) {
  const req = { headers } as unknown as Request;
  const set: Record<string, string> = {};
  const res = {
    setHeader: (k: string, v: string) => {
      set[k.toLowerCase()] = v;
    },
  } as unknown as Response;
  return { req, res, set };
}

describe('request-context', () => {
  it('không có X-Request-ID thì sinh UUID, gắn vào response và context', (done) => {
    const { req, res, set } = fakeReqRes();
    const next: NextFunction = () => {
      // Đọc sau một nhịp bất đồng bộ để chắc context đi theo async
      setImmediate(() => {
        const id = currentRequestId();
        expect(id).toMatch(/^[0-9a-f-]{36}$/);
        expect(set['x-request-id']).toBe(id);
        done();
      });
    };
    requestContextMiddleware(req, res, next);
  });

  it('giữ nguyên X-Request-ID client hoặc gateway gửi', (done) => {
    const { req, res, set } = fakeReqRes({ 'x-request-id': 'abc' });
    requestContextMiddleware(req, res, () => {
      expect(currentRequestId()).toBe('abc');
      expect(set['x-request-id']).toBe('abc');
      done();
    });
  });

  it('ngoài request thì không có request id', () => {
    expect(currentRequestId()).toBeUndefined();
  });
});
