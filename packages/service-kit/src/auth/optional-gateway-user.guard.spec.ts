import { BusinessException } from '../errors/business.exception';
import { OptionalGatewayUserGuard } from './optional-gateway-user.guard';
import { httpContext } from './test-context';

const saved = process.env.INTERNAL_API_TOKEN;
beforeEach(() => (process.env.INTERNAL_API_TOKEN = 'dev-internal-token'));
afterAll(() => (process.env.INTERNAL_API_TOKEN = saved));

// Component_Class_Design §7 — OptionalGatewayUserGuard
describe('OptionalGatewayUserGuard', () => {
  it('có X-User-*: req.user đúng', () => {
    const { ctx, req } = httpContext({
      'x-internal-token': 'dev-internal-token',
      'x-user-id': 'u1',
      'x-user-email': 'a@b.c',
      'x-user-role': 'admin',
    });

    expect(new OptionalGatewayUserGuard().canActivate(ctx)).toBe(true);
    expect(req.user).toEqual({ sub: 'u1', email: 'a@b.c', role: 'admin' });
  });

  it('không có X-User-*: req.user rỗng, vẫn cho qua', () => {
    const { ctx, req } = httpContext({
      'x-internal-token': 'dev-internal-token',
    });

    expect(new OptionalGatewayUserGuard().canActivate(ctx)).toBe(true);
    expect(req.user).toBeUndefined();
  });

  it('có X-User-* nhưng sai X-Internal-Token: 401', () => {
    const { ctx } = httpContext({
      'x-internal-token': 'sai',
      'x-user-id': 'u1',
      'x-user-role': 'user',
    });

    expect(() => new OptionalGatewayUserGuard().canActivate(ctx)).toThrow(
      BusinessException,
    );
  });
});
