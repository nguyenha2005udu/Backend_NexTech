import { BusinessException } from '../errors/business.exception';
import { InternalTokenGuard } from './internal-token.guard';
import { httpContext } from './test-context';

const saved = process.env.INTERNAL_API_TOKEN;
beforeEach(() => (process.env.INTERNAL_API_TOKEN = 'dev-internal-token'));
afterAll(() => (process.env.INTERNAL_API_TOKEN = saved));

function expect401(fn: () => unknown) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(BusinessException);
    expect((e as BusinessException).getStatus()).toBe(401);
    expect((e as BusinessException).code).toBe('NT-GEN-0002');
    return;
  }
  throw new Error('Mong đợi 401');
}

describe('InternalTokenGuard', () => {
  it('đúng X-Internal-Token: cho qua', () => {
    const { ctx } = httpContext({ 'x-internal-token': 'dev-internal-token' });
    expect(new InternalTokenGuard().canActivate(ctx)).toBe(true);
  });

  it('thiếu token: 401 NT-GEN-0002', () => {
    expect401(() => new InternalTokenGuard().canActivate(httpContext().ctx));
  });

  it('sai token, kể cả khác độ dài: 401', () => {
    for (const token of [
      'dev-internal-tokeX',
      'x',
      'dev-internal-token-dai-hon',
    ]) {
      expect401(() =>
        new InternalTokenGuard().canActivate(
          httpContext({ 'x-internal-token': token }).ctx,
        ),
      );
    }
  });

  it('service chưa cấu hình INTERNAL_API_TOKEN: từ chối mọi lời gọi', () => {
    process.env.INTERNAL_API_TOKEN = '';
    expect401(() =>
      new InternalTokenGuard().canActivate(
        httpContext({ 'x-internal-token': '' }).ctx,
      ),
    );
  });
});
