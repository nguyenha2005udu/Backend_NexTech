import { BusinessException } from '@nextech/service-kit';
import { HttpException } from '@nestjs/common';
import type { DataSource, EntityManager, Repository } from 'typeorm';
import { Order, type OrderStatus } from '../../database/entities/order.entity';
import { Payment } from '../../database/entities/payment.entity';
import { AdminOrderService } from './order.admin.service';

// PUT /api/admin/orders/:id/status — NT.ORDER API_Spec §1 route 11, business-spec §5 (BR-06),
// Component_Class_Design §7 "Chuyển trạng thái sai → 400 NT-ORD-1007".
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
  const service = new AdminOrderService(
    {} as Repository<Order>,
    dataSource as unknown as DataSource,
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

  // Giữ chỗ tới khi có code nền (quyết định 20-11-2026, current-task T3.2 [cần xác nhận] #1):
  // không đổi trạng thái khi chưa nhả kho / ghi tiền được.
  it.each<
    [OrderStatus, 'shipped' | 'cancelled', Partial<Payment> | null, string]
  >([
    ['pending', 'shipped', { method: 'cod', status: 'pending' }, 'T3.6'],
    ['pending', 'cancelled', null, 'T3.5'],
    ['paid', 'cancelled', { method: 'payos', status: 'success' }, 'T3.5'],
  ])(
    '%s → %s hợp lệ nhưng chưa có code nền → 501, không ghi (%s thay)',
    async (from, to, payment) => {
      givenOrder(from);
      givenPayment(payment);
      const err = await errorOf(service.updateStatus('o1', { status: to }));
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(501);
      expect(orderRepo.save).not.toHaveBeenCalled();
    },
  );
});
