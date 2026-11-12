import type { ExecutionContext } from '@nestjs/common';

// Chỉ dùng trong test: ExecutionContext giả với header và metadata của handler.
export function httpContext(
  headers: Record<string, string> = {},
  user?: unknown,
): {
  ctx: ExecutionContext;
  req: { headers: Record<string, string>; user?: unknown };
} {
  const req = { headers, user };
  const handler = () => undefined;
  class Controller {}
  const ctx = {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => handler,
    getClass: () => Controller,
  } as unknown as ExecutionContext;
  return { ctx, req };
}
