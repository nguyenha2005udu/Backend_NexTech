import type { ConfigService } from '@nestjs/config';
import type { DataSource, EntityManager } from 'typeorm';
import { Order } from '../../database/entities/order.entity';
import { SagaTask } from '../../database/entities/saga-task.entity';
import { OrderLockBusyError } from '../../database/db-lock-error';
import type { OrderLockService } from '../../redis/order-lock.service';
import type { PaymentCoreService } from '../payment/payment-core.service';
import type { CompensationService } from './compensation.service';
import { OrderCancelService } from './order-cancel.service';
import { noHold } from '../../test-helpers';

// NT.CHECKOUT_SAGA Component_Class_Design §7.1 (v1.7), API_Spec §2. Đua thật (huỷ hai lần đồng thời),
// số truy vấn: order-cancel.service.int-spec.ts.

describe('OrderCancelService', () => {
  const qb = {
    update: jest.fn(),
    set: jest.fn(),
    where: jest.fn(),
    returning: jest.fn(),
    execute: jest.fn(),
  };
  const m = {
    findOne: jest.fn(),
    insert: jest.fn(),
    createQueryBuilder: jest.fn(() => qb),
  };
  const ds = {
    transaction: jest.fn((cb: (em: EntityManager) => Promise<unknown>) =>
      cb(m as unknown as EntityManager),
    ),
  };
  const compensation = { run: jest.fn() };
  const paymentCore = { voidPendingByOrder: jest.fn() };
  // Khoá đơn (T3.9, BR-20): mặc định chạy thẳng fn; từng ca đổi sang bận
  const lock = { withOrderLock: jest.fn() };
  const svc = new OrderCancelService(
    ds as unknown as DataSource,
    compensation as unknown as CompensationService,
    paymentCore as unknown as PaymentCoreService,
    {
      getOrThrow: () => ({ budgetMs: 8000 }),
    } as unknown as ConfigService,
    lock as unknown as OrderLockService,
    noHold,
  );

  const UPDATED_AT = new Date('2026-11-21T10:00:00Z');
  const order = (o: Partial<Order> = {}) =>
    ({
      id: 'o1',
      user_id: 'u1',
      status: 'pending',
      saga_step: 'confirmed',
      discount_code: null,
      freeship_code: null,
      ...o,
    }) as Order;

  beforeEach(() => {
    jest.clearAllMocks();
    for (const fn of [qb.update, qb.set, qb.where, qb.returning]) {
      fn.mockReturnValue(qb);
    }
    qb.execute.mockResolvedValue({ raw: [{ updated_at: UPDATED_AT }] });
    m.insert.mockImplementation((_e: unknown, rows: unknown[]) =>
      Promise.resolve({
        identifiers: rows.map((_, i) => ({ id: `t${i + 1}` })),
      }),
    );
    compensation.run.mockResolvedValue(undefined);
    lock.withOrderLock.mockImplementation(
      (_id: string, fn: () => Promise<unknown>) => fn(),
    );
  });

  describe('cancelByUser', () => {
    it('bọc withOrderLock theo id đơn, chờ mặc định (BR-20)', async () => {
      m.findOne.mockResolvedValue(order());
      await svc.cancelByUser('u1', 'o1');
      expect(lock.withOrderLock).toHaveBeenCalledWith(
        'o1',
        expect.any(Function),
      );
    });

    it('khoá đơn bận → 409 NT-ORD-1012, không mở transaction, không nhả (NT.CHECKOUT_SAGA #28)', async () => {
      lock.withOrderLock.mockRejectedValue(new OrderLockBusyError('o1'));
      const err = (await svc
        .cancelByUser('u1', 'o1')
        .catch((e: unknown) => e)) as {
        code?: string;
        getStatus?: () => number;
      };
      expect(err.code).toBe('NT-ORD-1012');
      expect(err.getStatus?.()).toBe(409);
      expect(ds.transaction).not.toHaveBeenCalled();
      expect(compensation.run).not.toHaveBeenCalled();
    });

    it('gỡ hẹn hạn giữ hàng sau commit (BR-19, NT.ORDER_HOLD §10)', async () => {
      m.findOne.mockResolvedValue(order());
      const unschedule = jest.spyOn(noHold, 'unschedule');
      await svc.cancelByUser('u1', 'o1');
      expect(unschedule).toHaveBeenCalledWith('o1');
      unschedule.mockRestore();
    });

    it('khoá dòng đơn của đúng người gọi (FOR UPDATE, như be/)', async () => {
      m.findOne.mockResolvedValue(order());
      await svc.cancelByUser('u1', 'o1');
      expect(m.findOne).toHaveBeenCalledWith(Order, {
        where: { id: 'o1', user_id: 'u1' },
        lock: { mode: 'pessimistic_write' },
      });
    });

    it('không có hoặc không thuộc người gọi → 404 NT-ORD-1006', async () => {
      m.findOne.mockResolvedValue(null);
      await expect(svc.cancelByUser('u1', 'o1')).rejects.toMatchObject({
        status: 404,
        code: 'NT-ORD-1006',
      });
      expect(compensation.run).not.toHaveBeenCalled();
    });

    it.each(['processing', 'paid', 'shipped', 'cancelled', 'failed'])(
      'đơn %s → 400 NT-ORD-1008, không tạo task, không nhả (BR-06)',
      async (status) => {
        m.findOne.mockResolvedValue(
          order({ status: status as Order['status'] }),
        );
        await expect(svc.cancelByUser('u1', 'o1')).rejects.toMatchObject({
          status: 400,
          code: 'NT-ORD-1008',
          message: 'Đơn hàng đã được xử lý, không thể huỷ',
        });
        expect(m.insert).not.toHaveBeenCalled();
        expect(compensation.run).not.toHaveBeenCalled();
      },
    );

    it('hợp lệ → { id, status: cancelled, updated_at } như be/', async () => {
      m.findOne.mockResolvedValue(order());
      await expect(svc.cancelByUser('u1', 'o1')).resolves.toEqual({
        id: 'o1',
        status: 'cancelled',
        updated_at: UPDATED_AT,
      });
    });

    it('sau commit nhả ngay bằng task vừa tạo, không finish, trong ngân sách SAGA_BUDGET_MS', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
      m.findOne.mockResolvedValue(order({ discount_code: 'SALE10' }));
      try {
        await svc.cancelByUser('u1', 'o1');
      } finally {
        jest.restoreAllMocks();
      }
      expect(compensation.run).toHaveBeenCalledWith('o1', {
        tasks: [
          { id: 't1', order_id: 'o1', type: 'release_promotion', seq: 1 },
          { id: 't2', order_id: 'o1', type: 'release_stock', seq: 2 },
        ],
        finish: false,
        deadline: 1_008_000,
      });
    });

    it('nhả lỗi (kể cả DB) → vẫn trả kết quả, task còn tồn cho cron (test 17)', async () => {
      m.findOne.mockResolvedValue(order());
      compensation.run.mockRejectedValue(new Error('db down'));
      await expect(svc.cancelByUser('u1', 'o1')).resolves.toMatchObject({
        status: 'cancelled',
      });
    });

    it('lỗi trong transaction (chưa commit) → ném lại, không nhả', async () => {
      m.findOne.mockResolvedValue(order());
      m.insert.mockRejectedValue(new Error('insert lỗi'));
      await expect(svc.cancelByUser('u1', 'o1')).rejects.toThrow('insert lỗi');
      expect(compensation.run).not.toHaveBeenCalled();
    });
  });

  describe('cancel (dùng chung người mua, admin)', () => {
    it('UPDATE … RETURNING updated_at, không dùng save', async () => {
      await svc.cancel(m as unknown as EntityManager, order(), 'admin');
      expect(qb.update).toHaveBeenCalledWith(Order);
      expect(qb.set).toHaveBeenCalledWith({ status: 'cancelled' });
      expect(qb.where).toHaveBeenCalledWith('id = :id', { id: 'o1' });
      expect(qb.returning).toHaveBeenCalledWith(['updated_at']);
    });

    it('không mã → chỉ release_stock seq 2', async () => {
      const r = await svc.cancel(
        m as unknown as EntityManager,
        order(),
        'user',
      );
      expect(m.insert).toHaveBeenCalledWith(SagaTask, [
        { order_id: 'o1', type: 'release_stock', seq: 2 },
      ]);
      expect(r.tasks).toEqual([
        { id: 't1', order_id: 'o1', type: 'release_stock', seq: 2 },
      ]);
    });

    it('có mã → release_promotion seq 1 rồi release_stock seq 2', async () => {
      await svc.cancel(
        m as unknown as EntityManager,
        order({ freeship_code: 'SHIP30' }),
        'user',
      );
      expect(m.insert).toHaveBeenCalledWith(SagaTask, [
        { order_id: 'o1', type: 'release_promotion', seq: 1 },
        { order_id: 'o1', type: 'release_stock', seq: 2 },
      ]);
    });

    it('giao dịch pending → failed trong cùng transaction (be/ releaseOrderResources, NT.PAYMENT §2)', async () => {
      await svc.cancel(m as unknown as EntityManager, order(), 'user');
      expect(paymentCore.voidPendingByOrder).toHaveBeenCalledWith(m, 'o1');
    });

    it('không gọi service khác trong transaction', async () => {
      await svc.cancel(m as unknown as EntityManager, order(), 'admin');
      expect(compensation.run).not.toHaveBeenCalled();
    });
  });
});
