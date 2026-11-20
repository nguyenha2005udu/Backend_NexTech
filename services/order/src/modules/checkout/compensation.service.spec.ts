import { UpstreamBusinessError, UpstreamError } from '@nextech/service-kit';
import type { DataSource, EntityManager, Repository } from 'typeorm';
import { In, Not } from 'typeorm';
import type { CatalogClient } from '../../clients/catalog.client';
import type { PromotionClient } from '../../clients/promotion.client';
import { Order } from '../../database/entities/order.entity';
import { SagaTask } from '../../database/entities/saga-task.entity';
import { CompensationService } from './compensation.service';

// NT.CHECKOUT_SAGA Component_Class_Design §6 (v1.6): startForFailedSaga, run(orderId, deadline?), finish.
// §8 test 14 (thứ tự khởi chạy, promotion lỗi vẫn nhả kho), 19, 20, 23/24 (key). Đua thật: int-spec.

describe('CompensationService', () => {
  const orders = { update: jest.fn() };
  const tasks = { find: jest.fn(), update: jest.fn() };
  const m = { update: jest.fn(), insert: jest.fn() };
  const dataSource = {
    transaction: jest.fn((cb: (em: EntityManager) => Promise<unknown>) =>
      cb(m as unknown as EntityManager),
    ),
  };
  const catalog = { release: jest.fn() };
  const promotion = { release: jest.fn() };
  const svc = new CompensationService(
    orders as unknown as Repository<Order>,
    tasks as unknown as Repository<SagaTask>,
    dataSource as unknown as DataSource,
    catalog as unknown as CatalogClient,
    promotion as unknown as PromotionClient,
  );

  const order = (o: Partial<Order> = {}) =>
    ({
      id: 'o1',
      status: 'processing',
      saga_step: 'stock_reserved',
      discount_code: null,
      freeship_code: null,
      ...o,
    }) as Order;
  const task = (id: string, type: string, seq: number) =>
    ({
      id,
      order_id: 'o1',
      type,
      seq,
      status: 'pending',
      attempts: 0,
    }) as SagaTask;
  const outOfStock = new UpstreamBusinessError(
    'catalog',
    409,
    'NT-CAT-1001',
    'Hết hàng',
  );
  const FAR = Date.now() + 60_000;

  beforeEach(() => {
    jest.clearAllMocks();
    m.update.mockResolvedValue({ affected: 1 });
    orders.update.mockResolvedValue({ affected: 1 });
    tasks.update.mockResolvedValue({ affected: 1 });
    tasks.find.mockResolvedValue([]);
    catalog.release.mockResolvedValue({ status: 'released', restored: true });
    promotion.release.mockResolvedValue({ status: 'released', restored: true });
  });

  describe('startForFailedSaga', () => {
    it('đổi compensating có điều kiện, lưu lỗi gốc; giữ Idempotency-Key với lỗi 4xx (test 24)', async () => {
      await svc.startForFailedSaga(order(), outOfStock);
      expect(m.update).toHaveBeenCalledWith(
        Order,
        { id: 'o1', status: 'processing', saga_step: Not('compensating') },
        {
          saga_step: 'compensating',
          failure_code: 'NT-CAT-1001',
          failure_message: 'Hết hàng',
          failure_status: 409,
        },
      );
    });

    it('lỗi 5xx → nhả Idempotency-Key để gửi lại tạo đơn mới (test 23)', async () => {
      await svc.startForFailedSaga(
        order(),
        new UpstreamError('catalog', 'ECONNREFUSED', 'not_executed'),
      );
      expect(m.update).toHaveBeenCalledWith(
        Order,
        expect.anything(),
        expect.objectContaining({ failure_status: 503, idempotency_key: null }),
      );
    });

    it('không mã → chỉ release_stock seq 2 (luôn nhả kho: lệnh giữ có thể đã tới nơi)', async () => {
      await svc.startForFailedSaga(order(), outOfStock);
      expect(m.insert).toHaveBeenCalledWith(SagaTask, [
        { order_id: 'o1', type: 'release_stock', seq: 2 },
      ]);
    });

    it('có mã → release_promotion seq 1 + release_stock seq 2', async () => {
      await svc.startForFailedSaga(
        order({ freeship_code: 'SHIP30' }),
        outOfStock,
      );
      expect(m.insert).toHaveBeenCalledWith(SagaTask, [
        { order_id: 'o1', type: 'release_promotion', seq: 1 },
        { order_id: 'o1', type: 'release_stock', seq: 2 },
      ]);
    });

    it('thua đua (bên khác đã chuyển đơn) → không tạo task, không chạy (test 19)', async () => {
      m.update.mockResolvedValue({ affected: 0 });
      await svc.startForFailedSaga(order(), outOfStock);
      expect(m.insert).not.toHaveBeenCalled();
      expect(tasks.find).not.toHaveBeenCalled();
    });

    it('thắng → chạy nhả ngay với deadline của request', async () => {
      tasks.find.mockResolvedValue([task('t2', 'release_stock', 2)]);
      await svc.startForFailedSaga(order(), outOfStock, FAR);
      expect(catalog.release).toHaveBeenCalledWith('o1', { deadline: FAR });
    });
  });

  describe('run', () => {
    it('đọc task pending theo seq', async () => {
      await svc.run('o1');
      expect(tasks.find).toHaveBeenCalledWith({
        where: { order_id: 'o1', status: 'pending' },
        order: { seq: 'ASC' },
      });
    });

    it('khởi chạy nhả mã trước nhả kho; xong hết → đánh dấu done một câu → finish (test 14)', async () => {
      const calls: string[] = [];
      promotion.release.mockImplementation(() => {
        calls.push('promotion');
        return Promise.resolve({});
      });
      catalog.release.mockImplementation(() => {
        calls.push('catalog');
        return Promise.resolve({});
      });
      tasks.find.mockResolvedValue([
        task('t1', 'release_promotion', 1),
        task('t2', 'release_stock', 2),
      ]);

      await svc.run('o1');

      expect(calls).toEqual(['promotion', 'catalog']);
      expect(tasks.update).toHaveBeenCalledTimes(1);
      expect(tasks.update).toHaveBeenCalledWith(
        { id: In(['t1', 't2']) },
        expect.objectContaining({ status: 'done' }),
      );
      expect(tasks.update).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ done_at: expect.any(Date) as unknown }),
      );
      expect(orders.update).toHaveBeenCalledWith(
        { id: 'o1', status: 'processing', saga_step: 'compensating' },
        { status: 'failed', saga_step: 'compensated' },
      );
    });

    it('promotion lỗi vẫn nhả kho; ghi attempts, last_error; không finish (test 14)', async () => {
      promotion.release.mockRejectedValue(
        new UpstreamError('promotion', 'ECONNREFUSED', 'not_executed'),
      );
      tasks.find.mockResolvedValue([
        { ...task('t1', 'release_promotion', 1), attempts: 2 },
        task('t2', 'release_stock', 2),
      ]);

      await svc.run('o1');

      expect(catalog.release).toHaveBeenCalledWith('o1', {
        deadline: undefined,
      });
      expect(tasks.update).toHaveBeenCalledWith(
        { id: 't1' },
        { attempts: 3, last_error: 'promotion ECONNREFUSED (not_executed)' },
      );
      expect(tasks.update).toHaveBeenCalledWith(
        { id: In(['t2']) },
        expect.objectContaining({ status: 'done' }),
      );
      expect(orders.update).not.toHaveBeenCalled();
    });

    it('last_error của lỗi nghiệp vụ: target, status, mã — không có body của đích', async () => {
      catalog.release.mockRejectedValue(
        new UpstreamBusinessError('catalog', 400, 'NT-GEN-0001', ['x']),
      );
      tasks.find.mockResolvedValue([task('t2', 'release_stock', 2)]);
      await svc.run('o1');
      expect(tasks.update).toHaveBeenCalledWith(
        { id: 't2' },
        { attempts: 1, last_error: 'catalog 400 NT-GEN-0001' },
      );
    });

    it('không còn task pending → finish (task cuối xong nhưng finish lỗi lần trước; nền test 22)', async () => {
      await svc.run('o1');
      expect(tasks.update).not.toHaveBeenCalled();
      expect(orders.update).toHaveBeenCalledTimes(1);
    });

    it('hết ngân sách giữa chừng → dừng, task sau còn pending, không finish', async () => {
      let now = 0;
      jest.spyOn(Date, 'now').mockImplementation(() => now);
      promotion.release.mockImplementation(() => {
        now = 9_500; // còn 500 ms
        return Promise.resolve({});
      });
      tasks.find.mockResolvedValue([
        task('t1', 'release_promotion', 1),
        task('t2', 'release_stock', 2),
      ]);
      try {
        await svc.run('o1', 10_000);
        expect(catalog.release).not.toHaveBeenCalled();
        expect(tasks.update).toHaveBeenCalledWith(
          { id: In(['t1']) },
          expect.objectContaining({ status: 'done' }),
        );
        expect(orders.update).not.toHaveBeenCalled();
      } finally {
        jest.restoreAllMocks();
      }
    });

    it('finish muộn khi đơn đã pending/cancelled: UPDATE có điều kiện không khớp, không lỗi (test 20)', async () => {
      orders.update.mockResolvedValue({ affected: 0 });
      await expect(svc.run('o1')).resolves.toBeUndefined();
    });
  });
});
