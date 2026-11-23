import {
  RetryableError,
  UpstreamBusinessError,
  UpstreamError,
  type EventEnvelope,
} from '@nextech/service-kit';
import type { DataSource, EntityManager } from 'typeorm';
import type { IdentityClient } from '../../clients/identity.client';
import { Notification } from '../../database/entities/notification.entity';
import type { MailService } from '../../mail/mail.service';
import { EventHandlerService } from './event-handler.service';

// NT.NOTIFICATION Component_Class_Design §4, §5: idempotent, email trong transaction, identity/SMTP lỗi → thử lại.
// Chống trùng bằng Postgres thật: event-handler.service.int-spec.ts.

const USER = '11111111-2222-4333-8444-555555555555';

const alert = (channel: string): EventEnvelope => ({
  event_id: '0a6c8f1e-7a58-4a1b-9e3a-6a4ad4b0a4c1',
  type: 'price.alert.triggered',
  version: 1,
  occurred_at: '2026-11-04T10:00:00.000Z',
  source: 'catalog',
  request_id: null,
  data: {
    alert_id: 'al1',
    user_id: USER,
    product_id: 'p1',
    product_name: 'Tai nghe X',
    current_price: 990000,
    target_price: 1000000,
    channel,
  },
});

describe('EventHandlerService', () => {
  const execute = jest.fn();
  const qb = {
    insert: () => qb,
    into: () => qb,
    values: () => qb,
    orIgnore: () => qb,
    returning: () => qb,
    execute,
  };
  const m = { createQueryBuilder: () => qb, insert: jest.fn() };
  const ds = {
    transaction: jest.fn((cb: (em: EntityManager) => Promise<unknown>) =>
      cb(m as unknown as EntityManager),
    ),
  };
  const identity = { getUser: jest.fn() };
  const mail = { sendPriceAlertTriggered: jest.fn() };
  const svc = new EventHandlerService(
    ds as unknown as DataSource,
    identity as unknown as IdentityClient,
    mail as unknown as MailService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    execute.mockResolvedValue({ raw: [{ event_id: 'x' }] });
    identity.getUser.mockResolvedValue({ id: USER, email: 'a@b.c' });
    mail.sendPriceAlertTriggered.mockResolvedValue(undefined);
  });

  it('sự kiện mới: tạo một thông báo', async () => {
    await expect(svc.process(alert('app'))).resolves.toBe('processed');
    expect(m.insert).toHaveBeenCalledWith(
      Notification,
      expect.objectContaining({ user_id: USER, type: 'price_alert' }),
    );
    expect(identity.getUser).not.toHaveBeenCalled();
  });

  it('bản trùng (processed_events đã có): không tạo thông báo, không gửi mail', async () => {
    execute.mockResolvedValue({ raw: [] });
    await expect(svc.process(alert('email'))).resolves.toBe('duplicate');
    expect(m.insert).not.toHaveBeenCalled();
    expect(mail.sendPriceAlertTriggered).not.toHaveBeenCalled();
  });

  it('kênh email: lấy email từ identity rồi gửi', async () => {
    await svc.process(alert('email'));
    expect(identity.getUser).toHaveBeenCalledWith(USER);
    expect(mail.sendPriceAlertTriggered).toHaveBeenCalledWith(
      'a@b.c',
      'Tai nghe X',
      990000,
      1000000,
    );
  });

  it('SMTP lỗi: ném RetryableError để rollback và thử lại', async () => {
    mail.sendPriceAlertTriggered.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(svc.process(alert('email'))).rejects.toBeInstanceOf(
      RetryableError,
    );
  });

  it('identity lỗi hạ tầng: RetryableError', async () => {
    identity.getUser.mockRejectedValue(
      new UpstreamError('identity', 'ECONNREFUSED', 'not_executed'),
    );
    await expect(svc.process(alert('email'))).rejects.toBeInstanceOf(
      RetryableError,
    );
  });

  it('identity 404: giữ thông báo, không gửi, không thử lại', async () => {
    identity.getUser.mockRejectedValue(
      new UpstreamBusinessError('identity', 404, 'NT-IDN-1004', 'x'),
    );
    await expect(svc.process(alert('email'))).resolves.toBe('processed');
    expect(m.insert).toHaveBeenCalled();
    expect(mail.sendPriceAlertTriggered).not.toHaveBeenCalled();
  });
});
