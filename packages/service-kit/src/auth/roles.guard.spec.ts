import { Reflector } from '@nestjs/core';
import { Roles } from './decorators';
import { RolesGuard } from './roles.guard';
import { httpContext } from './test-context';

describe('RolesGuard (giữ nguyên monolith)', () => {
  const reflector = new Reflector();

  function ctxWithRoles(roles: string[] | undefined, user?: { role: string }) {
    const { ctx } = httpContext({}, user);
    // Gắn metadata trực tiếp lên handler, như @Roles() trên một method
    if (roles) (Roles(...roles) as (target: object) => void)(ctx.getHandler());
    return ctx;
  }

  it('route không khai @Roles: cho qua', () => {
    expect(new RolesGuard(reflector).canActivate(ctxWithRoles(undefined))).toBe(
      true,
    );
  });

  it('đúng vai trò: cho qua', () => {
    const ctx = ctxWithRoles(['admin'], { role: 'admin' });
    expect(new RolesGuard(reflector).canActivate(ctx)).toBe(true);
  });

  it('sai vai trò hoặc chưa có user: chặn (NestJS trả 403, filter gắn NT-GEN-0003)', () => {
    expect(
      new RolesGuard(reflector).canActivate(
        ctxWithRoles(['admin'], { role: 'user' }),
      ),
    ).toBe(false);
    expect(new RolesGuard(reflector).canActivate(ctxWithRoles(['admin']))).toBe(
      false,
    );
  });
});
