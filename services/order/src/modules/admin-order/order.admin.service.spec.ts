import { BusinessException } from '@nextech/service-kit';
import type { DataSource, EntityManager, Repository } from 'typeorm';
import { Order, type OrderStatus } from '../../database/entities/order.entity';
import { Payment } from '../../database/entities/payment.entity';
import type { OrderCancelService } from '../checkout/order-cancel.service';
import { OrderLockBusyError } from '../../database/db-lock-error';
import type { OrderLockService } from '../../redis/order-lock.service';
import type { PaymentCoreService } from '../payment/payment-core.service';
import { AdminOrderService } from './order.admin.service';
import { noHold } from '../../test-helpers';

// PUT /api/admin/orders/:id/status — NT.ORDER API_Spec §1 route 11, business-spec §5 (BR-06),
// Component_Class_Design §7 "Chuyển trạng thái sai → 400 NT-ORD-1007". T3.5: huỷ qua OrderCancelService
// (NT.CHECKOUT_SAGA §7.1 v1.7), chỉ đọc payments khi shipped (NT.ORDER v1.6).
// findAll, findOne: order.admin.service.int-spec.ts (Postgres thật, QueryBuilder).

const UPDATED = new Date('2026-11-20T02:00:00Z');

describe('AdminOrderService.updateStatus', () => {
  const orderRepo = { findOne: jest.fn(), save: jest.fn() };
  const paymentRepo = { findOne: jest.fn() };
  const manager = {
    getRepository: jest.fn((entity: unknown) =>
      entity === Order ? orderRepo : paymentRepo,
    ),
  };
  const dataSource = {
    transaction: jest.fn((cb: (m: EntityManager) => Promise<unknown>) =>
      cb(manager as unknown as EntityManager),
    ),
  };
  const TASKS = [{ id: 't1', order_id: 'o1', type: 'release_stock', seq: 2 }];
  const orderCancel = { cancel: jest.fn(), releaseAfterCommit: jest.fn() };
  const paymentCore = { confirmCodByOrder: jest.fn() };
  const lock = { withOrderLock: jest.fn() };
  const service = new AdminOrderService(
    {} as Repository<Order>,
    dataSource as unknown as DataSource,
    orderCancel as unknown as OrderCancelService,
    paymentCore as unknown as PaymentCoreService,
    lock as unknown as OrderLockService,
    noHold,
  );

  const givenOrder = (status: OrderStatus) =>
    orderRepo.findOne.mockResolvedValue({ id: 'o1', status });
  const givenPayment = (p: Partial<Payment> | null) =>
    paymentRepo.findOne.mockResolvedValue(p);

  const errorOf = (p: Promise<unknown>) => p.catch((e: unknown) => e);

  beforeEach(() => {
    jest.clearAllMocks();
    orderRepo.save.mockImplementation((o: Order) =>
      Promise.resolve({ ...o, updated_at: UPDATED }),
    );
    givenPayment(null);
    orderCancel.cancel.mockResolvedValue({
      result: { id: 'o1', status: 'cancelled', updated_at: UPDATED },
      tasks: TASKS,
    });
    orderCancel.releaseAfterCommit.mockResolvedValue(undefined);
    lock.withOrderLock.mockImplementation(
      (_id: string, fn: () => Promise<unknown>) => fn(),
    );
  });

  it('bọc withOrderLock theo id đơn (BR-20, NT.ORDER route 11 bước 4)', async () => {
    givenOrder('paid');
    await service.updateStatus('o1', { status: 'shipped' });
    expect(lock.withOrderLock).toHaveBeenCalledWith('o1', expect.any(Function));
  });

  it.each<['cancelled' | 'shipped', OrderStatus]>([
    ['cancelled', 'pending'],
    ['shipped', 'paid'],
  ])(
    'đổi sang %s → gỡ hẹn hạn giữ hàng sau commit (BR-19)',
    async (to, from) => {
      givenOrder(from);
      const unschedule = jest.spyOn(noHold, 'unschedule');
      await service.updateStatus('o1', { status: to });
      expect(unschedule).toHaveBeenCalledWith('o1');
      unschedule.mockRestore();
    },
  );

  it('khoá đơn bận → 409 NT-ORD-1012, đơn không đổi, không nhả (NT.ORDER §7)', async () => {
    lock.withOrderLock.mockRejectedValue(new OrderLockBusyError('o1', 'db'));
    const err = await errorOf(
      service.updateStatus('o1', { status: 'cancelled' }),
    );
    expect((err as BusinessException).code).toBe('NT-ORD-1012');
    expect((err as BusinessException).getStatus()).toBe(409);
    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(orderCancel.releaseAfterCommit).not.toHaveBeenCalled();
  });

  it('khoá dòng đơn trong transaction (FOR UPDATE, như be/)', async () => {
    givenOrder('paid');
    await service.updateStatus('o1', { status: 'shipped' });
    expect(dataSource.transaction).toHaveBeenCalled();
    expect(orderRepo.findOne).toHaveBeenCalledWith({
      where: { id: 'o1' },
      lock: { mode: 'pessimistic_write' },
    });
  });

  it('không có đơn → 404 NT-ORD-1006', async () => {
    orderRepo.findOne.mockResolvedValue(null);
    const err = await errorOf(
      service.updateStatus('o-x', { status: 'shipped' }),
    );
    expect(err).toBeInstanceOf(BusinessException);
    expect((err as BusinessException).code).toBe('NT-ORD-1006');
    expect((err as BusinessException).getStatus()).toBe(404);
  });

  it.each<[OrderStatus, 'shipped' | 'cancelled']>([
    ['processing', 'shipped'],
    ['processing', 'cancelled'],
    ['failed', 'shipped'],
    ['failed', 'cancelled'],
    ['shipped', 'shipped'],
    ['shipped', 'cancelled'],
    ['cancelled', 'shipped'],
    ['cancelled', 'cancelled'],
  ])('%s → %s: 400 NT-ORD-1007, câu chữ be/, không ghi', async (from, to) => {
    givenOrder(from);
    const err = await errorOf(service.updateStatus('o1', { status: to }));
    expect(err).toBeInstanceOf(BusinessException);
    expect((err as BusinessException).code).toBe('NT-ORD-1007');
    expect((err as BusinessException).getStatus()).toBe(400);
    expect((err as BusinessException).message).toBe(
      `Không thể chuyển đơn từ "${from}" sang "${to}"`,
    );
    expect(orderRepo.save).not.toHaveBeenCalled();
  });

  it.each<[string, Partial<Payment> | null]>([
    ['chưa có giao dịch', null],
    ['giao dịch PayOS chưa trả', { method: 'payos', status: 'pending' }],
    ['giao dịch COD không còn pending', { method: 'cod', status: 'failed' }],
  ])('pending → shipped khi %s → 400 NT-ORD-1007', async (_, payment) => {
    givenOrder('pending');
    givenPayment(payment);
    const err = await errorOf(
      service.updateStatus('o1', { status: 'shipped' }),
    );
    expect((err as BusinessException).code).toBe('NT-ORD-1007');
    expect(paymentRepo.findOne).toHaveBeenCalledWith({
      where: { order_id: 'o1' },
    });
    expect(orderRepo.save).not.toHaveBeenCalled();
  });

  it('paid → shipped: đổi trạng thái, trả { id, status, updated_at } như be/', async () => {
    givenOrder('paid');

    await expect(
      service.updateStatus('o1', { status: 'shipped' }),
    ).resolves.toEqual({ id: 'o1', status: 'shipped', updated_at: UPDATED });
    expect(orderRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'o1', status: 'shipped' }),
    );
  });

  // T3.6: giao COD xác nhận giao dịch trong cùng transaction (NT.ORDER API_Spec route 11 bước 4, NT.PAYMENT §5)
  it('pending → shipped (COD pending): confirmCodByOrder cùng transaction rồi đổi đơn shipped', async () => {
    givenOrder('pending');
    givenPayment({ method: 'cod', status: 'pending' });
    await expect(
      service.updateStatus('o1', { status: 'shipped' }),
    ).resolves.toEqual({ id: 'o1', status: 'shipped', updated_at: UPDATED });
    expect(paymentCore.confirmCodByOrder).toHaveBeenCalledWith(manager, 'o1');
    expect(orderRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'o1', status: 'shipped' }),
    );
  });

  it('paid → shipped: không gọi confirmCodByOrder (giao dịch đã success)', async () => {
    givenOrder('paid');
    await service.updateStatus('o1', { status: 'shipped' });
    expect(paymentCore.confirmCodByOrder).not.toHaveBeenCalled();
  });

  it.each<OrderStatus>(['pending', 'paid'])(
    '%s → cancelled: OrderCancelService.cancel(admin) trong transaction, nhả sau commit, không đọc payments (test 32)',
    async (from) => {
      givenOrder(from);
      await expect(
        service.updateStatus('o1', { status: 'cancelled' }),
      ).resolves.toEqual({
        id: 'o1',
        status: 'cancelled',
        updated_at: UPDATED,
      });
      expect(orderCancel.cancel).toHaveBeenCalledWith(
        manager,
        { id: 'o1', status: from },
        'admin',
      );
      expect(orderCancel.releaseAfterCommit).toHaveBeenCalledWith('o1', TASKS);
      expect(paymentRepo.findOne).not.toHaveBeenCalled();
      expect(orderRepo.save).not.toHaveBeenCalled();
    },
  );

  it('huỷ: transaction lỗi (chưa commit) → không nhả', async () => {
    givenOrder('pending');
    orderCancel.cancel.mockRejectedValue(new Error('insert lỗi'));
    await expect(
      service.updateStatus('o1', { status: 'cancelled' }),
    ).rejects.toThrow('insert lỗi');
    expect(orderCancel.releaseAfterCommit).not.toHaveBeenCalled();
  });
});
