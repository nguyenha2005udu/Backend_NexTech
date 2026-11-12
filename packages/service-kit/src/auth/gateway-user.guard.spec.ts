import { BusinessException } from '../errors/business.exception';
import { GatewayUserGuard } from './gateway-user.guard';
import { httpContext } from './test-context';

const saved = process.env.INTERNAL_API_TOKEN;
beforeEach(() => (process.env.INTERNAL_API_TOKEN = 'dev-internal-token'));
afterAll(() => (process.env.INTERNAL_API_TOKEN = saved));

const userHeaders = {
  'x-internal-token': 'dev-internal-token',
  'x-user-id': 'aaaaaaaa-0000-4000-8000-000000000002',
  'x-user-email': 'buyer@nextech.local',
  'x-user-role': 'user',
};

describe('GatewayUserGuard', () => {
  it('đủ header: dựng req.user cùng shape monolith { sub, email, role }', () => {
    const { ctx, req } = httpContext(userHeaders);

    expect(new GatewayUserGuard().canActivate(ctx)).toBe(true);
    expect(req.user).toEqual({
      sub: 'aaaaaaaa-0000-4000-8000-000000000002',
      email: 'buyer@nextech.local',
      role: 'user',
    });
  });

  it('thiếu X-User-Id hoặc X-User-Role: 401 NT-GEN-0002', () => {
    for (const missing of ['x-user-id', 'x-user-role']) {
      const headers: Record<string, string> = { ...userHeaders };
      delete headers[missing];
      expect(() =>
        new GatewayUserGuard().canActivate(httpContext(headers).ctx),
      ).toThrow(BusinessException);
    }
  });

  it('có X-User-* nhưng sai X-Internal-Token: 401', () => {
    const { ctx, req } = httpContext({
      ...userHeaders,
      'x-internal-token': 'gia-mao',
    });

    expect(() => new GatewayUserGuard().canActivate(ctx)).toThrow(
      BusinessException,
    );
    expect(req.user).toBeUndefined();
  });
});
