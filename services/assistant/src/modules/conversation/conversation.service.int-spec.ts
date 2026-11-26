import { BusinessException } from '@nextech/service-kit';
import { randomUUID } from 'node:crypto';
import type { ProductItem } from '../../clients/catalog.client';
import { Conversation } from '../../database/entities/conversation.entity';
import { Message } from '../../database/entities/message.entity';
import { aiUnavailable } from '../../errors';
import { createTestDb, TestDb } from '../../test-helpers';
import type { ChatService } from '../chat/chat.service';
import { ConversationService } from './conversation.service';

// POSTGRES THẬT — không mock DB. ChatService là giả (AI ngoài hệ thống).
// Chạy: docker compose up -d postgres
//   npm run test:int -w services/assistant -- conversation
// NT.ASSISTANT_CONVERSATION Component_Class_Design §5 (phần service; phần cookie ở conversation.controller.spec.ts).

jest.setTimeout(60_000);

const PRODUCT: ProductItem = {
  id: 'p1',
  name: 'Sony WH-1000XM5',
  brand: 'Sony',
  price: '900000',
  rating: '4.5',
  primary_image: null,
  category_name: 'Tai nghe',
  tags: [],
};

async function expectError(
  call: Promise<unknown>,
  status: number,
  code: string,
) {
  const err = (await call.catch((e: unknown) => e)) as BusinessException;
  expect(err).toBeInstanceOf(BusinessException);
  expect(err.getStatus()).toBe(status);
  expect(err.code).toBe(code);
}

describe('ConversationService (Postgres thật)', () => {
  let db: TestDb;
  let service: ConversationService;
  const chat = {
    chat: jest.fn<
      ReturnType<ChatService['chat']>,
      Parameters<ChatService['chat']>
    >(),
  };

  beforeAll(async () => {
    db = await createTestDb();
    service = new ConversationService(
      db.ds.getRepository(Conversation),
      db.ds.getRepository(Message),
      db.ds,
      chat as unknown as ChatService,
    );
  });
  afterAll(async () => db?.cleanup());
  beforeEach(async () => {
    await db.ds.query('TRUNCATE conversations CASCADE');
    chat.chat.mockReset();
    chat.chat.mockResolvedValue({ reply: 'Chào bạn', products: [] });
  });

  const messages = (id: string) =>
    db.ds.getRepository(Message).find({
      where: { conversation_id: id },
      order: { created_at: 'ASC' },
    });

  describe('tạo phiên, quyền truy cập (BR-14)', () => {
    it('khách tạo phiên: user_id rỗng, guest_id là của thiết bị', async () => {
      const guest = randomUUID();
      const res = await service.create(null, guest, {});
      const row = await db.ds.getRepository(Conversation).findOneByOrFail({
        id: res.id,
      });
      expect(row).toMatchObject({
        user_id: null,
        guest_id: guest,
        channel: 'chat',
      });
      expect(res).toMatchObject({ channel: 'chat', current_step: 'search' });
    });

    it('đã đăng nhập tạo phiên: guest_id rỗng dù có cookie', async () => {
      const user = randomUUID();
      const res = await service.create(user, randomUUID(), {
        channel: 'voice',
      });
      const row = await db.ds.getRepository(Conversation).findOneByOrFail({
        id: res.id,
      });
      expect(row).toMatchObject({
        user_id: user,
        guest_id: null,
        channel: 'voice',
      });
    });

    it('phiên khách: đúng cookie 200; sai cookie, không cookie, đã đăng nhập máy khác: 403', async () => {
      const guest = randomUUID();
      const { id } = await service.create(null, guest, {});

      await expect(service.findOne(id, null, guest)).resolves.toMatchObject({
        id,
      });
      await expectError(
        service.findOne(id, null, randomUUID()),
        403,
        'NT-AST-1002',
      );
      await expectError(service.findOne(id, null, null), 403, 'NT-AST-1002');
      await expectError(
        service.findOne(id, randomUUID(), null),
        403,
        'NT-AST-1002',
      );
      await expectError(
        service.getMessages(id, null, null, {}),
        403,
        'NT-AST-1002',
      );
    });

    it('phiên có chủ: người khác hoặc khách: 403; không tồn tại hoặc id sai định dạng: 404', async () => {
      const owner = randomUUID();
      const { id } = await service.create(owner, null, {});
      await expect(service.findOne(id, owner, null)).resolves.toMatchObject({
        id,
      });
      await expectError(
        service.findOne(id, randomUUID(), null),
        403,
        'NT-AST-1002',
      );
      await expectError(
        service.findOne(id, null, randomUUID()),
        403,
        'NT-AST-1002',
      );
      await expectError(
        service.findOne(randomUUID(), owner, null),
        404,
        'NT-AST-1001',
      );
      await expectError(
        service.findOne('abc', owner, null),
        404,
        'NT-AST-1001',
      );
    });

    it('findMine: chỉ phiên của mình, mới nhất trước', async () => {
      const me = randomUUID();
      const a = await service.create(me, null, {});
      const b = await service.create(me, null, {});
      await service.create(randomUUID(), null, {});
      await db.ds.query(
        `UPDATE conversations SET started_at = now() - interval '1 hour' WHERE id = $1`,
        [a.id],
      );
      const list = await service.findMine(me);
      expect(list.map((c) => c.id)).toEqual([b.id, a.id]);
    });
  });

  describe('gán phiên (BR-15)', () => {
    it('claim: phiên có chủ, guest_id rỗng; lần hai claimed 0; người khác dùng cookie cũ không nhận được', async () => {
      const guest = randomUUID();
      const user = randomUUID();
      await service.create(null, guest, {});
      await service.create(null, guest, {});
      await service.create(null, randomUUID(), {});

      await expect(service.claim(user, guest)).resolves.toEqual({ claimed: 2 });
      const rows = await db.ds.getRepository(Conversation).find({
        where: { user_id: user },
      });
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.guest_id === null)).toBe(true);

      await expect(service.claim(user, guest)).resolves.toEqual({ claimed: 0 });
      await expect(service.claim(randomUUID(), guest)).resolves.toEqual({
        claimed: 0,
      });
      await expect(service.claim(user, null)).resolves.toEqual({ claimed: 0 });
    });
  });

  describe('gửi tin nhắn', () => {
    it('thành công: đúng 2 dòng, câu hỏi trước câu trả lời; tin đầu đặt title 100 ký tự', async () => {
      const guest = randomUUID();
      const { id } = await service.create(null, guest, {});
      const content = 'a'.repeat(150);

      const res = await service.sendMessage(id, null, guest, { content });

      const rows = await messages(id);
      expect(rows.map((r) => r.sender)).toEqual(['user', 'agent']);
      expect(rows[0].created_at.getTime()).toBeLessThan(
        rows[1].created_at.getTime(),
      );
      expect(res).toMatchObject({
        id: rows[1].id,
        sender: 'agent',
        content: 'Chào bạn',
        message_type: 'text',
        metadata: null,
      });
      const conv = await db.ds
        .getRepository(Conversation)
        .findOneByOrFail({ id });
      expect(conv.title).toBe('a'.repeat(100));
      expect(conv.current_step).toBe('search');

      // Tin thứ hai không đổi title
      await service.sendMessage(id, null, guest, { content: 'khác' });
      const again = await db.ds
        .getRepository(Conversation)
        .findOneByOrFail({ id });
      expect(again.title).toBe('a'.repeat(100));
    });

    it('có sản phẩm: product_card, metadata.products, current_step = recommend', async () => {
      const user = randomUUID();
      const { id } = await service.create(user, null, {});
      chat.chat.mockResolvedValueOnce({ reply: 'Có', products: [PRODUCT] });

      const res = await service.sendMessage(id, user, null, {
        content: 'tai nghe',
      });

      expect(res).toMatchObject({
        message_type: 'product_card',
        metadata: { products: [PRODUCT] },
      });
      const conv = await db.ds
        .getRepository(Conversation)
        .findOneByOrFail({ id });
      expect(conv.current_step).toBe('recommend');
    });

    it('AI lỗi: không có dòng mới, title không đổi (BR-16)', async () => {
      const user = randomUUID();
      const { id } = await service.create(user, null, {});
      chat.chat.mockRejectedValueOnce(aiUnavailable());

      await expectError(
        service.sendMessage(id, user, null, { content: 'hỏi' }),
        503,
        'NT-AST-1004',
      );
      expect(await messages(id)).toHaveLength(0);
      const conv = await db.ds
        .getRepository(Conversation)
        .findOneByOrFail({ id });
      expect(conv.title).toBeNull();
    });

    it('lịch sử quá 20 tin: chỉ gửi 20 tin gần nhất, đúng thứ tự, không gồm câu hỏi hiện tại', async () => {
      const user = randomUUID();
      const { id } = await service.create(user, null, {});
      const base = Date.now() - 60_000;
      await db.ds.getRepository(Message).insert(
        Array.from({ length: 25 }, (_, i) => ({
          conversation_id: id,
          sender: i % 2 ? 'agent' : 'user',
          content: `tin ${i}`,
          created_at: new Date(base + i * 1000),
        })),
      );

      await service.sendMessage(id, user, null, { content: 'mới' });

      const arg = chat.chat.mock.calls[0][0];
      const history = arg.history ?? [];
      expect(arg.message).toBe('mới');
      expect(history).toHaveLength(20);
      expect(history[0]).toEqual({ role: 'model', text: 'tin 5' });
      expect(history[19]).toEqual({ role: 'user', text: 'tin 24' });
    });

    it('getMessages: phân trang, tăng dần, limit tối đa 100, khoá data', async () => {
      const user = randomUUID();
      const { id } = await service.create(user, null, {});
      await service.sendMessage(id, user, null, { content: 'q1' });
      await service.sendMessage(id, user, null, { content: 'q2' });

      const page = await service.getMessages(id, user, null, {
        page: '2',
        limit: '3',
      });
      expect(page).toMatchObject({ total: 4, page: 2, limit: 3 });
      expect(page.data.map((m) => m.content)).toEqual(['Chào bạn']);

      const all = await service.getMessages(id, user, null, { limit: '1000' });
      expect(all.limit).toBe(100);
      expect(all.data.map((m) => m.content)).toEqual([
        'q1',
        'Chào bạn',
        'q2',
        'Chào bạn',
      ]);
    });
  });
});
