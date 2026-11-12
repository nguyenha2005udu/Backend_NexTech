import type { ModuleRef } from '@nestjs/core';
import { redisHealthCheck, typeOrmHealthCheck } from './checks';

const refWith = (value: unknown) =>
  ({ get: jest.fn().mockReturnValue(value) }) as unknown as ModuleRef;

describe('health checks', () => {
  it('typeOrmHealthCheck: tên db, bắt buộc, chạy SELECT 1', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const c = typeOrmHealthCheck();

    await c.check(refWith({ query }));

    expect(c.name).toBe('db');
    expect(c.required).not.toBe(false);
    expect(query).toHaveBeenCalledWith('SELECT 1');
  });

  it('redisHealthCheck: lấy client theo token và ping', async () => {
    const ping = jest.fn().mockResolvedValue('PONG');
    const get = jest.fn().mockReturnValue({ ping });
    const ref = { get } as unknown as ModuleRef;
    const c = redisHealthCheck('REDIS_CLIENT');

    await c.check(ref);

    expect(c.name).toBe('redis');
    expect(get).toHaveBeenCalledWith('REDIS_CLIENT', { strict: false });
    expect(ping).toHaveBeenCalled();
  });
});
