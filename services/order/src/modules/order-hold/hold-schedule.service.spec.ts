import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import type { HoldConfig } from '../../config/configuration';
import { HOLD_DUE_KEY, HoldScheduleService } from './hold-schedule.service';

// NT.ORDER_HOLD v1.4 Component_Class_Design §6 (BR-19): hẹn/gỡ hẹn trong sorted set nt:order:hold:due.
// Lỗi Redis ở schedule/unschedule/defer chỉ log warn (quét DB bù — §8); due ném để job biết Redis hỏng.

const CFG = { ttlMs: 900_000, graceMs: 60_000 } as HoldConfig;

describe('HoldScheduleService', () => {
  const redis = { zadd: jest.fn(), zrem: jest.fn(), zrangebyscore: jest.fn() };
  const svc = new HoldScheduleService(
    redis as unknown as Redis,
    { getOrThrow: () => CFG } as unknown as ConfigService,
  );
  let warn: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    redis.zadd.mockResolvedValue(1);
    redis.zrem.mockResolvedValue(1);
    redis.zrangebyscore.mockResolvedValue(['o1']);
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });
  afterEach(() => warn.mockRestore());

  it('key là nt:order:hold:due', () => {
    expect(HOLD_DUE_KEY).toBe('nt:order:hold:due');
  });

  it('deadlineFrom = now + ORDER_HOLD_TTL_MS', () => {
    const now = new Date('2026-11-23T10:00:00Z');
    expect(svc.deadlineFrom(now)).toEqual(new Date('2026-11-23T10:15:00Z'));
  });

  it('schedule: ZADD điểm = hạn (epoch ms)', async () => {
    const at = new Date('2026-11-23T10:15:00Z');
    await svc.schedule('o1', at);
    expect(redis.zadd).toHaveBeenCalledWith(HOLD_DUE_KEY, at.getTime(), 'o1');
  });

  it('unschedule: ZREM; defer: ZADD điểm mới', async () => {
    await svc.unschedule('o1');
    expect(redis.zrem).toHaveBeenCalledWith(HOLD_DUE_KEY, 'o1');
    await svc.defer('o1', 123);
    expect(redis.zadd).toHaveBeenCalledWith(HOLD_DUE_KEY, 123, 'o1');
  });

  it('Redis lỗi ở schedule/unschedule/defer → không ném, log warn', async () => {
    redis.zadd.mockRejectedValue(new Error('Command timed out'));
    redis.zrem.mockRejectedValue(new Error('Stream not writeable'));
    await expect(svc.schedule('o1', new Date())).resolves.toBeUndefined();
    await expect(svc.unschedule('o1')).resolves.toBeUndefined();
    await expect(svc.defer('o1', 1)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it('due: đơn có điểm ≤ now − ân hạn, giới hạn số lượng', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    expect(await svc.due(50)).toEqual(['o1']);
    expect(redis.zrangebyscore).toHaveBeenCalledWith(
      HOLD_DUE_KEY,
      '-inf',
      1_000_000 - CFG.graceMs,
      'LIMIT',
      0,
      50,
    );
    jest.restoreAllMocks();
  });

  it('due: Redis lỗi → ném (job chuyển sang quét DB)', async () => {
    redis.zrangebyscore.mockRejectedValue(new Error('down'));
    await expect(svc.due(50)).rejects.toThrow('down');
  });
});
