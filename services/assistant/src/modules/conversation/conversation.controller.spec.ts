import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AllExceptionsFilter } from '@nextech/service-kit';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import { ConversationController } from './conversation.controller';
import { ConversationService } from './conversation.service';

// NT.ASSISTANT_CONVERSATION Component_Class_Design §5, phần HTTP: cookie guest_id, guard, DTO.
// Cấu hình app giống bootstrapService của service-kit (cookie-parser, ValidationPipe, filter).

const TOKEN = 'dev-internal-token';
const GUEST = '33333333-3333-4333-8333-333333333333';
const USER = '44444444-4444-4444-8444-444444444444';
const CONV = '55555555-5555-4555-8555-555555555555';

describe('ConversationController', () => {
  let app: INestApplication<App>;
  let service: Record<string, jest.Mock>;
  const saved = process.env.INTERNAL_API_TOKEN;

  beforeAll(() => (process.env.INTERNAL_API_TOKEN = TOKEN));
  afterAll(() => (process.env.INTERNAL_API_TOKEN = saved));

  beforeEach(async () => {
    service = {
      create: jest.fn().mockResolvedValue({ id: CONV }),
      findMine: jest.fn().mockResolvedValue([]),
      claim: jest.fn().mockResolvedValue({ claimed: 1 }),
      findOne: jest.fn().mockResolvedValue({ id: CONV }),
      sendMessage: jest.fn().mockResolvedValue({ id: 'm1' }),
      getMessages: jest.fn().mockResolvedValue({ data: [] }),
    };
    const mod = await Test.createTestingModule({
      controllers: [ConversationController],
      providers: [{ provide: ConversationService, useValue: service }],
    }).compile();
    app = mod.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });
  afterEach(() => app.close());

  const asGuest = (r: request.Test) => r.set('X-Internal-Token', TOKEN);
  const asUser = (r: request.Test) =>
    r
      .set('X-Internal-Token', TOKEN)
      .set('X-User-Id', USER)
      .set('X-User-Email', 'a@b.c')
      .set('X-User-Role', 'user');
  const cookies = (res: request.Response) =>
    ([] as string[]).concat(res.headers['set-cookie'] ?? []);

  it('khách tạo phiên chưa có cookie: cấp Set-Cookie guest_id httpOnly, 365 ngày', async () => {
    const res = await asGuest(
      request(app.getHttpServer()).post('/conversations').send({}),
    ).expect(201);

    const [cookie] = cookies(res);
    expect(cookie).toMatch(/^guest_id=[0-9a-f-]{36};/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Max-Age=31536000/);
    const guestId = /^guest_id=([^;]+)/.exec(cookie)![1];
    expect(service.create).toHaveBeenCalledWith(null, guestId, {});
  });

  it('khách đã có cookie: dùng lại đúng giá trị', async () => {
    await asGuest(
      request(app.getHttpServer())
        .post('/conversations')
        .set('Cookie', `guest_id=${GUEST}`)
        .send({ channel: 'voice' }),
    ).expect(201);
    expect(service.create).toHaveBeenCalledWith(null, GUEST, {
      channel: 'voice',
    });
  });

  it('cookie không phải UUID: coi như không có, cấp mới, không 400', async () => {
    const res = await asGuest(
      request(app.getHttpServer())
        .post('/conversations')
        .set('Cookie', "guest_id=' OR 1=1")
        .send({}),
    ).expect(201);
    expect(cookies(res)[0]).toMatch(/^guest_id=[0-9a-f-]{36};/);

    await asGuest(
      request(app.getHttpServer())
        .get(`/conversations/${CONV}`)
        .set('Cookie', 'guest_id=abc'),
    ).expect(200);
    expect(service.findOne).toHaveBeenCalledWith(CONV, null, null);
  });

  it('đã đăng nhập tạo phiên: không cấp cookie', async () => {
    const res = await asUser(
      request(app.getHttpServer()).post('/conversations').send({}),
    ).expect(201);
    expect(cookies(res)).toHaveLength(0);
    expect(service.create).toHaveBeenCalledWith(USER, null, {});
  });

  it('claim: 200, truyền guest_id, xoá cookie', async () => {
    const res = await asUser(
      request(app.getHttpServer())
        .post('/conversations/claim')
        .set('Cookie', `guest_id=${GUEST}`),
    ).expect(200);
    expect(res.body).toEqual({ claimed: 1 });
    expect(service.claim).toHaveBeenCalledWith(USER, GUEST);
    expect(cookies(res)[0]).toMatch(/^guest_id=;.*Expires=Thu, 01 Jan 1970/);
    expect(cookies(res)[0]).toMatch(/HttpOnly/);
  });

  it('GET /conversations, claim: khách gọi thì 401', async () => {
    await asGuest(request(app.getHttpServer()).get('/conversations')).expect(
      401,
    );
    await asGuest(
      request(app.getHttpServer()).post('/conversations/claim'),
    ).expect(401);
  });

  it('gửi tin: content 2001 ký tự hoặc rỗng → 400; 2000 ký tự → 201', async () => {
    const send = (content: string) =>
      asUser(
        request(app.getHttpServer())
          .post(`/conversations/${CONV}/messages`)
          .send({ content }),
      );
    await send('a'.repeat(2001)).expect(400);
    await send('').expect(400);
    expect(service.sendMessage).not.toHaveBeenCalled();
    await send('a'.repeat(2000)).expect(201);
  });

  it('không có X-Internal-Token: 401', async () => {
    await request(app.getHttpServer()).post('/conversations').expect(401);
  });
});
