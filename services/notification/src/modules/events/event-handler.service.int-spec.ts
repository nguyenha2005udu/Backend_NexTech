import { randomUUID } from 'node:crypto';
import { RetryableError, type EventEnvelope } from '@nextech/service-kit';
import type { IdentityClient } from '../../clients/identity.client';
import { Notification } from '../../database/entities/notification.entity';
import { ProcessedEvent } from '../../database/entities/processed-event.entity';
import type { MailService } from '../../mail/mail.service';
import { createTestDb, type TestDb } from '../../test-helpers';
import { EventHandlerService } from './event-handler.service';

// POSTGRES THẬT — chạy: docker compose up -d postgres; npm run test:int -w services/notification
// NT.NOTIFICATION Component_Class_Design §5: một sự kiện một thông báo; gửi trùng (kể cả đồng thời) vẫn một;
// SMTP lỗi thì rollback, không để lại processed_events (lần thử lại xử lý được).

jest.setTimeout(60_000);

describe('EventHandlerService (Postgres thật)', () => {
  let db: TestDb;
  const identity = { getUser: jest.fn() };
  const mail = { sendPriceAlertTriggered: jest.fn() };
  let svc: EventHandlerService;

  beforeAll(async () => {
    db = await createTestDb();
    svc = new EventHandlerService(
      db.ds,
      identity as unknown as IdentityClient,
      mail as unknown as MailService,
    );
  });
  afterAll(() => db.cleanup());
  beforeEach(() => {
    jest.clearAllMocks();
    identity.getUser.mockResolvedValue({ email: 'a@b.c' });
  });

  const created = (userId: string): EventEnvelope => ({
    event_id: randomUUID(),
    type: 'order.created',
    version: 1,
    occurred_at: new Date().toISOString(),
    source: 'order',
    request_id: null,
    data: { order_id: randomUUID(), user_id: userId, total: 230000 },
  });
  const countFor = (userId: string) =>
    db.ds.getRepository(Notification).countBy({ user_id: userId });

  it('một sự kiện → một thông báo, một processed_events', async () => {
    const user = randomUUID();
    const e = created(user);
    await expect(svc.process(e)).resolves.toBe('processed');
    expect(await countFor(user)).toBe(1);
    expect(
      await db.ds
        .getRepository(ProcessedEvent)
        .countBy({ event_id: e.event_id }),
    ).toBe(1);
  });

  it('gửi trùng event_id, tuần tự và đồng thời → vẫn một thông báo', async () => {
    const user = randomUUID();
    const e = created(user);
    await svc.process(e);
    await expect(svc.process(e)).resolves.toBe('duplicate');

    const e2 = created(user);
    const results = await Promise.all([svc.process(e2), svc.process(e2)]);
    expect(results.sort()).toEqual(['duplicate', 'processed']);
    expect(await countFor(user)).toBe(2);
  });

  it('SMTP lỗi → rollback cả thông báo và processed_events; lần thử lại tạo đúng một', async () => {
    const user = randomUUID();
    const e: EventEnvelope = {
      ...created(user),
      type: 'price.alert.triggered',
      data: {
        alert_id: randomUUID(),
        user_id: user,
        product_id: randomUUID(),
        product_name: 'Tai nghe X',
        current_price: 990000,
        target_price: 1000000,
        channel: 'email',
      },
    };
    mail.sendPriceAlertTriggered.mockRejectedValueOnce(new Error('smtp down'));
    await expect(svc.process(e)).rejects.toBeInstanceOf(RetryableError);
    expect(await countFor(user)).toBe(0);

    await expect(svc.process(e)).resolves.toBe('processed');
    expect(await countFor(user)).toBe(1);
    expect(mail.sendPriceAlertTriggered).toHaveBeenCalledTimes(2);
  });
});
