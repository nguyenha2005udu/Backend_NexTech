import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { DataSource } from 'typeorm';
import type { HoldConfig } from '../../config/configuration';
import type { HoldScheduleService } from '../order-hold/hold-schedule.service';
import { HoldExpiryJob } from './hold-expiry.job';
import type { HoldExpiryService } from './hold-expiry.service';

// NT.ORDER_HOLD v1.4 Component_Class_Design §8 (HoldExpiryJob), §11 #21, #25. Huỷ thật: hold-expiry.service.int-spec.ts

const HOLD = { batch: 50, dbSweepEvery: 3, graceMs: 60_000 } as HoldConfig;

describe('HoldExpiryJob.tick', () => {
  const service = {
    expireOne: jest.fn(),
    deferUntil: new Map<string, number>(),
    pruneDeferred: jest.fn(),
  };
  const hold = { due: jest.fn() };
  const ds = { query: jest.fn() };
  const makeJob = () =>
    new HoldExpiryJob(
      service as unknown as HoldExpiryService,
      hold as unknown as HoldScheduleService,
      ds as unknown as DataSource,
      { getOrThrow: () => HOLD } as unknown as ConfigService,
    );
  let job: HoldExpiryJob; // mỗi ca một job: bộ đếm lượt bắt đầu lại
  let error: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    job = makeJob();
    service.expireOne.mockResolvedValue('cancelled');
    hold.due.mockResolvedValue(['a']);
    ds.query.mockResolvedValue([{ id: 'b' }]);
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });
  afterEach(() => error.mockRestore());

  it('Redis sống: chỉ lấy từ sorted set; lượt thứ dbSweepEvery quét thêm DB, gộp không trùng', async () => {
    const fresh = job;
    ds.query.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    await fresh.tick();
    await fresh.tick();
    expect(ds.query).not.toHaveBeenCalled();
    service.expireOne.mockClear();
    await fresh.tick(); // lượt 3
    expect(ds.query).toHaveBeenCalledTimes(1);
    expect(service.expireOne.mock.calls.map((c: unknown[]) => c[0])).toEqual([
      'a',
      'b',
    ]);
  });

  it('#21 Redis lỗi → quét DB ngay lượt này', async () => {
    hold.due.mockRejectedValue(new Error('down'));
    await job.tick();
    expect(ds.query).toHaveBeenCalledTimes(1);
    expect(service.expireOne).toHaveBeenCalledWith('b', { payosDown: false });
  });

  it('quét DB loại đơn đang hoãn, đúng ân hạn và lô', async () => {
    hold.due.mockRejectedValue(new Error('down'));
    service.deferUntil.set('x', Date.now() + 60_000);
    await job.tick();
    expect(ds.query).toHaveBeenCalledWith(expect.stringContaining('ANY'), [
      HOLD.graceMs,
      ['x'],
      HOLD.batch,
    ]);
    service.deferUntil.clear();
  });

  it('lỗi một đơn → log error, đơn khác vẫn chạy; mọi đơn cùng một TickState', async () => {
    hold.due.mockResolvedValue(['a', 'c']);
    service.expireOne.mockRejectedValueOnce(new Error('db'));
    await job.tick();
    expect(service.expireOne).toHaveBeenCalledTimes(2);
    const [t1, t2] = service.expireOne.mock.calls.map((c: unknown[]) => c[1]);
    expect(t1).toBe(t2);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('a'));
  });

  it('lượt trước chưa xong → lượt sau bỏ qua (không chồng lượt)', async () => {
    let release!: () => void;
    service.expireOne.mockReturnValueOnce(
      new Promise((r) => (release = () => r('cancelled'))),
    );
    const first = job.tick();
    await new Promise((r) => setImmediate(r));
    await job.tick();
    expect(service.expireOne).toHaveBeenCalledTimes(1);
    release();
    await first;
  });
});

// #25: HoldExpiryModule là module NGỌN — chỉ app.module import; không forwardRef (NT.ORDER_HOLD §4)
describe('Đồ thị module (NT.ORDER_HOLD §4, #25)', () => {
  const SRC = join(__dirname, '..', '..');
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory()
        ? files(p)
        : p.endsWith('.ts')
          ? [p]
          : [];
    });
  const code = files(SRC).filter((f) => !/\.(int-)?spec\.ts$/.test(f));

  it('chỉ app.module.ts import HoldExpiryModule', () => {
    const importers = code.filter(
      (f) =>
        /hold-expiry\.module/.test(readFileSync(f, 'utf8')) &&
        !f.endsWith('hold-expiry.module.ts'),
    );
    expect(
      importers.map((f) => f.replace(SRC, '').replace(/\\/g, '/')),
    ).toEqual(['/app.module.ts']);
  });

  it('không có forwardRef', () => {
    expect(
      code.filter((f) => readFileSync(f, 'utf8').includes('forwardRef(')),
    ).toEqual([]);
  });
});
