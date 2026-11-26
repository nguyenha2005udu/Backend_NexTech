import { BusinessException, UpstreamError } from '@nextech/service-kit';
import { randomUUID } from 'node:crypto';
import type { IdentityClient } from '../../clients/identity.client';
import { Conversation } from '../../database/entities/conversation.entity';
import { Message } from '../../database/entities/message.entity';
import { countQueries, createTestDb, TestDb } from '../../test-helpers';
import { ConversationAdminService } from './conversation.admin.service';

// POSTGRES THẬT — không mock DB. Identity là giả.
// Chạy: docker compose up -d postgres
//   npm run test:int -w services/assistant -- admin
// NT.ASSISTANT_ADMIN Component_Class_Design §3.

jest.setTimeout(60_000);

describe('ConversationAdminService (Postgres thật)', () => {
  let db: TestDb;
  let service: ConversationAdminService;
  const identity = {
    getUsers: jest.fn<ReturnType<IdentityClient['getUsers']>, [string[]]>(),
  };

  beforeAll(async () => {
    db = await createTestDb();
    service = new ConversationAdminService(
      db.ds.getRepository(Conversation),
      db.ds.getRepository(Message),
      identity as unknown as IdentityClient,
    );
  });
  afterAll(async () => db?.cleanup());
  beforeEach(async () => {
    await db.ds.query('TRUNCATE conversations CASCADE');
    identity.getUsers.mockReset();
  });
  afterEach(() => jest.restoreAllMocks());

  const seed = (o: Partial<Conversation>) =>
    db.ds
      .getRepository(Conversation)
      .save(
        db.ds.getRepository(Conversation).create({ channel: 'chat', ...o }),
      );

  it('cả trang là phiên khách: "Khách", không gọi identity', async () => {
    await seed({ guest_id: randomUUID() });
    const res = await service.findAll({});
    expect(res.data[0].user_name).toBe('Khách');
    expect(identity.getUsers).not.toHaveBeenCalled();
    expect(res).not.toHaveProperty('user_names_unavailable');
  });

  // Thiết kế ghi 2 truy vấn (dữ liệu, đếm); TypeORM 1.x gộp còn 1 khi không join — chặn trên là 2
  it('có người dùng: đúng tên; không còn trong identity: "Người dùng đã xoá"; ≤ 2 truy vấn, 1 lời gọi', async () => {
    const alive = randomUUID();
    const gone = randomUUID();
    await seed({ user_id: alive });
    await seed({ user_id: alive });
    await seed({ user_id: gone });
    identity.getUsers.mockResolvedValue({
      items: [
        { id: alive, full_name: 'Nguyễn A', email: 'a@b.c', avatar_url: null },
      ],
    });

    const q = countQueries();
    const res = await service.findAll({});
    expect(q.count).toBeLessThanOrEqual(2);
    q.restore();

    expect(identity.getUsers).toHaveBeenCalledTimes(1);
    expect([...identity.getUsers.mock.calls[0][0]].sort()).toEqual(
      [alive, gone].sort(),
    );
    expect(new Set(res.data.map((d) => d.user_name))).toEqual(
      new Set(['Nguyễn A', 'Người dùng đã xoá']),
    );
    expect(res.total).toBe(3);
  });

  it('identity lỗi: vẫn trả, user_name null, user_names_unavailable true; phiên khách vẫn "Khách"', async () => {
    await seed({ user_id: randomUUID() });
    await seed({ guest_id: randomUUID() });
    identity.getUsers.mockRejectedValue(
      new UpstreamError('identity', 'ECONNREFUSED', 'not_executed', 503),
    );

    const res = await service.findAll({});
    expect(res.user_names_unavailable).toBe(true);
    expect(res.data.map((d) => d.user_name).sort()).toEqual(
      ['Khách', null].sort(),
    );
  });

  it('lọc channel, from, to: đúng dữ liệu và total; limit=1000 chặn còn 100', async () => {
    await seed({ guest_id: randomUUID(), channel: 'voice' });
    const old = await seed({ guest_id: randomUUID(), channel: 'chat' });
    await seed({ guest_id: randomUUID(), channel: 'chat' });
    await db.ds.query(
      `UPDATE conversations SET started_at = '2026-01-01T00:00:00' WHERE id = $1`,
      [old.id],
    );

    const voice = await service.findAll({ channel: 'voice' });
    expect(voice.total).toBe(1);

    const range = await service.findAll({
      from: '2025-12-31T00:00:00.000Z',
      to: '2026-01-02T00:00:00.000Z',
    });
    expect(range.total).toBe(1);
    expect(range.data[0].id).toBe(old.id);

    const all = await service.findAll({ limit: '1000' });
    expect(all.limit).toBe(100);
    expect(all.total).toBe(3);
  });

  it('chi tiết: tin nhắn tăng dần; không tồn tại: 404 NT-AST-1001', async () => {
    const c = await seed({ guest_id: randomUUID() });
    await db.ds.getRepository(Message).insert([
      {
        conversation_id: c.id,
        sender: 'agent',
        content: 'b',
        created_at: new Date(2000),
      },
      {
        conversation_id: c.id,
        sender: 'user',
        content: 'a',
        created_at: new Date(1000),
      },
    ]);
    const res = await service.findOneDetail(c.id);
    expect(res.messages.map((m) => m.content)).toEqual(['a', 'b']);

    for (const id of [randomUUID(), 'abc']) {
      const err = (await service
        .findOneDetail(id)
        .catch((e: unknown) => e)) as BusinessException;
      expect(err).toBeInstanceOf(BusinessException);
      expect(err.getStatus()).toBe(404);
      expect(err.code).toBe('NT-AST-1001');
    }
  });
});
