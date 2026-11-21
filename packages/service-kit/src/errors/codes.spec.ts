import * as kit from '../index';
import { codeForStatus, GEN_ERROR } from './codes';

// api-convention §6: status → mã chung. Status ngoài bảng: 5xx → NT-GEN-0500, 4xx → NT-GEN-0001.
describe('codeForStatus', () => {
  it.each([
    [400, GEN_ERROR.INVALID_INPUT],
    [401, GEN_ERROR.UNAUTHORIZED],
    [403, GEN_ERROR.FORBIDDEN],
    [404, GEN_ERROR.NOT_FOUND],
    [409, GEN_ERROR.CONFLICT],
    [500, GEN_ERROR.INTERNAL],
    [503, GEN_ERROR.UPSTREAM_UNAVAILABLE],
    [504, GEN_ERROR.UPSTREAM_TIMEOUT],
  ])('%i → %s', (status, code) => {
    expect(codeForStatus(status)).toBe(code);
  });

  it('5xx ngoài bảng → NT-GEN-0500', () => {
    expect(codeForStatus(502)).toBe(GEN_ERROR.INTERNAL);
    expect(codeForStatus(501)).toBe(GEN_ERROR.INTERNAL);
  });

  it('4xx ngoài bảng → NT-GEN-0001', () => {
    expect(codeForStatus(422)).toBe(GEN_ERROR.INVALID_INPUT);
    expect(codeForStatus(429)).toBe(GEN_ERROR.INVALID_INPUT);
  });

  it('export từ gói', () => {
    expect(kit.codeForStatus).toBe(codeForStatus);
  });
});
