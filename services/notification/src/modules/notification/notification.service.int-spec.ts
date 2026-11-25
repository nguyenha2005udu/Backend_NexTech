import { randomUUID } from 'node:crypto';
import { Notification } from '../../database/entities/notification.entity';
import { createTestDb, type TestDb } from '../../test-helpers';
import { NotificationService } from './notification.service';

// POSTGRES THẬT — NT.NOTIFICATION Component_Class_Design §5: lọc, unread-count, đọc của người khác, read-all.

jest.setTimeout(60_000);

describe('NotificationService (Postgres thật)', () => {
  let db: TestDb;
  let svc: NotificationService;
  const me = randomUUID();
  const other = randomUUID();
  let mineOrder: Notification;
  let othersOne: Notification;

  beforeAll(async () => {
    db = await createTestDb();
    const repo = db.ds.getRepository(Notification);
    svc = new NotificationService(repo);
    const base = { title: 't', body: 'b', data: null, channel: 'app' as const };
    [mineOrder] = await repo.save([
      repo.create({ ...base, user_id: me, type: 'order_update' }),
      repo.create({ ...base, user_id: me, type: 'price_alert' }),
      repo.create({ ...base, user_id: me, type: 'price_alert', is_read: true }),
    ]);
    othersOne = await repo.save(
      repo.create({ ...base, user_id: other, type: 'price_alert' }),
    );
  });
  afterAll(() => db.cleanup());

  it('unread=true, type=price_alert → lọc đúng, body đúng khuôn', async () => {
    const r = await svc.findMine(me, {
      unread: 'true',
      type: 'price_alert',
      page: 1,
      limit: 20,
    });
    expect(r).toMatchObject({ total: 1, page: 1, limit: 20, totalPages: 1 });
    expect(Object.keys(r.items[0]).sort()).toEqual(
      ['body', 'created_at', 'data', 'id', 'is_read', 'title', 'type'].sort(),
    );
  });

  it('unread-count trả { count }', async () => {
    await expect(svc.unreadCount(me)).resolves.toEqual({ count: 2 });
  });

  it('PUT /read thông báo của người khác, id lạ, id không phải UUID → 404 NT-NTF-1001', async () => {
    for (const id of [othersOne.id, randomUUID(), 'abc']) {
      await expect(svc.markRead(me, id)).rejects.toMatchObject({
        status: 404,
        code: 'NT-NTF-1001',
      });
    }
  });

  it('PUT /read của mình → { id, is_read: true }', async () => {
    await expect(svc.markRead(me, mineOrder.id)).resolves.toEqual({
      id: mineOrder.id,
      is_read: true,
    });
  });

  it('read-all chỉ đổi của người gọi, trả { updated }', async () => {
    await expect(svc.markAllRead(me)).resolves.toEqual({ updated: 1 });
    await expect(svc.unreadCount(other)).resolves.toEqual({ count: 1 });
  });
});
