import type { ConfigService } from '@nestjs/config';
import type { DataSource, Repository } from 'typeorm';
import { In } from 'typeorm';
import type { Order } from '../../database/entities/order.entity';
import type { OrderItem } from '../../database/entities/order-item.entity';
import type { CheckoutSagaService } from './checkout-saga.service';
import type { CompensationService } from './compensation.service';
import { ReconcileJob } from './reconcile.job';

// NT.CHECKOUT_SAGA Component_Class_Design §7 (v1.7). SQL thật (chọn lô, SKIP LOCKED, tuổi 15 giây):
// reconcile.job.int-spec.ts.

describe('ReconcileJob', () => {
  const ds = { query: jest.fn() };
  const items = { find: jest.fn() };
  const saga = { advance: jest.fn() };
  const compensation = { startForFailedSaga: jest.fn(), run: jest.fn() };
  let enabled = true;
  const make = () =>
    new ReconcileJob(
      ds as unknown as DataSource,
      items as unknown as Repository<OrderItem>,
      saga as unknown as CheckoutSagaService,
      compensation as unknown as CompensationService,
      {
        getOrThrow: () => ({ resilienceEnabled: enabled }),
      } as unknown as ConfigService,
    );

  const NOW = 1_800_000_000_000;
  const stuck = (id: string, deadlineOffsetMs: number | null) =>
    ({
      id,
      status: 'processing',
      saga_step: 'started',
      saga_deadline:
        deadlineOffsetMs === null ? null : new Date(NOW + deadlineOffsetMs),
    }) as unknown as Order;

  // ds.query theo thứ tự gọi: bước 1 (UPDATE … RETURNING → [rows, count]), bước 2, bước 3
  function queries(step1: Order[], step2: string[] = [], step3: string[] = []) {
    ds.query.mockImplementation((sql: string) => {
      if (sql.includes('UPDATE orders')) {
        return Promise.resolve([step1, step1.length]);
      }
      if (sql.includes('FROM saga_tasks') && sql.includes('DISTINCT')) {
        return Promise.resolve(step2.map((order_id) => ({ order_id })));
      }
      return Promise.resolve(step3.map((id) => ({ id })));
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    enabled = true;
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    items.find.mockResolvedValue([]);
    saga.advance.mockResolvedValue({ kind: 'confirmed' });
    compensation.startForFailedSaga.mockResolvedValue(undefined);
    compensation.run.mockResolvedValue(undefined);
    queries([]);
  });
  afterEach(() => jest.restoreAllMocks());

  it('RESILIENCE_ENABLED=false → không làm gì (baseline thí nghiệm)', async () => {
    enabled = false;
    await make().tick();
    expect(ds.query).not.toHaveBeenCalled();
  });

  it('lượt trước chưa xong → bỏ lượt mới', async () => {
    const job = make();
    let release!: () => void;
    ds.query.mockImplementationOnce(
      () =>
        new Promise((r) => {
          release = () => r([[], 0]);
        }),
    );
    const first = job.tick();
    await job.tick();
    expect(ds.query).toHaveBeenCalledTimes(1);
    release();
    await first;
  });

  it('bước 1: chọn lô có giới hạn 50, tuổi 15 giây, SKIP LOCKED; đọc items một câu cho cả lô', async () => {
    queries([stuck('o1', 60_000), stuck('o2', 60_000)]);
    items.find.mockResolvedValue([
      { id: 'i1', order_id: 'o1' },
      { id: 'i2', order_id: 'o2' },
      { id: 'i3', order_id: 'o1' },
    ]);

    await make().tick();

    const [sql, params] = ds.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/FOR UPDATE SKIP LOCKED/);
    expect(sql).toMatch(/LOCALTIMESTAMP/);
    expect(params).toEqual([15_000, 50]);
    expect(items.find).toHaveBeenCalledTimes(1);
    expect(items.find).toHaveBeenCalledWith({
      where: { order_id: In(['o1', 'o2']) },
    });
    const first = saga.advance.mock.calls[0] as [Order, ...unknown[]];
    expect(first).toHaveLength(1); // không deadline
    expect(first[0].items.map((i) => i.id)).toEqual(['i1', 'i3']);
  });

  it('không có đơn kẹt → không đọc items', async () => {
    await make().tick();
    expect(items.find).not.toHaveBeenCalled();
  });

  it('quá saga_deadline → hoàn tác với 504 NT-GEN-0504, không advance (test 12)', async () => {
    queries([stuck('o1', -1)]);
    await make().tick();
    expect(saga.advance).not.toHaveBeenCalled();
    const [order, reason] = compensation.startForFailedSaga.mock.calls[0] as [
      Order,
      { getStatus(): number; code: string },
    ];
    expect(order.id).toBe('o1');
    expect(reason.getStatus()).toBe(504);
    expect(reason.code).toBe('NT-GEN-0504');
    // cron không truyền deadline
    expect(compensation.startForFailedSaga.mock.calls[0]).toHaveLength(2);
  });

  it('thiếu saga_deadline → coi như quá hạn (không thử lại mãi)', async () => {
    queries([stuck('o1', null)]);
    await make().tick();
    expect(compensation.startForFailedSaga).toHaveBeenCalledTimes(1);
  });

  it('lỗi một đơn không chặn đơn sau', async () => {
    queries([stuck('o1', 60_000), stuck('o2', 60_000)]);
    saga.advance.mockRejectedValueOnce(new Error('db lỗi'));
    await make().tick();
    expect(saga.advance).toHaveBeenCalledTimes(2);
  });

  it('bước 2: chạy task còn tồn từng đơn, không deadline (test 10, 17)', async () => {
    queries([], ['o3', 'o4']);
    compensation.run.mockRejectedValueOnce(new Error('x'));
    await make().tick();
    expect(compensation.run).toHaveBeenCalledWith('o3');
    expect(compensation.run).toHaveBeenCalledWith('o4');
    const [sql, params] = ds.query.mock.calls[1] as [string, unknown[]];
    expect(sql).toMatch(/status = 'pending'/);
    expect(params).toEqual([50]);
  });

  it('bước 3: đơn compensating hết task → run để chốt failed (test 22)', async () => {
    queries([], [], ['o5']);
    await make().tick();
    expect(compensation.run).toHaveBeenCalledWith('o5');
    const [sql, params] = ds.query.mock.calls[2] as [string, unknown[]];
    expect(sql).toMatch(/saga_step = 'compensating'/);
    expect(sql).toMatch(/NOT EXISTS/);
    expect(params).toEqual([15_000, 50]);
  });

  it('câu chọn của một bước lỗi (DB) → các bước sau vẫn chạy, tick không ném', async () => {
    ds.query
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce([{ order_id: 'o3' }])
      .mockResolvedValueOnce([]);
    await expect(make().tick()).resolves.toBeUndefined();
    expect(compensation.run).toHaveBeenCalledWith('o3');
  });

  it('lượt lỗi vẫn mở khoá running cho lượt sau', async () => {
    const job = make();
    ds.query.mockRejectedValue(new Error('db down'));
    await job.tick();
    await job.tick();
    expect(ds.query).toHaveBeenCalledTimes(6);
  });
});
