import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AllExceptionsFilter } from '@nextech/service-kit';
import request from 'supertest';
import type { Server } from 'node:http';
import { UsersInternalController } from './users.internal.controller';
import { UsersInternalService } from './users.internal.service';

// Test bắt buộc Component_Class_Design §7: /internal/* không có X-Internal-Token → 401; batch > 100 id → 400.

const TOKEN = 'test-internal-token';
const uuid = (i: number) =>
  `aaaaaaaa-0000-4000-8000-${String(i).padStart(12, '0')}`;

describe('UsersInternalController', () => {
  let app: INestApplication;
  const svc = {
    getUser: jest.fn().mockResolvedValue({ id: uuid(1) }),
    getAddress: jest.fn().mockResolvedValue({ id: uuid(2) }),
    getUsers: jest.fn().mockResolvedValue({ items: [] }),
    countUsers: jest.fn().mockResolvedValue({ total_users: 2 }),
  };

  beforeAll(async () => {
    process.env.INTERNAL_API_TOKEN = TOKEN;
    const mod = await Test.createTestingModule({
      controllers: [UsersInternalController],
      providers: [{ provide: UsersInternalService, useValue: svc }],
    }).compile();
    app = mod.createNestApplication();
    // Như bootstrapService của service-kit
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

  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  it.each([
    ['GET', `/internal/users/${uuid(1)}`],
    ['GET', `/internal/users/${uuid(1)}/addresses/${uuid(2)}`],
    ['POST', '/internal/users/batch'],
    ['GET', '/internal/stats/users'],
  ])('%s %s không có X-Internal-Token → 401', async (method, path) => {
    const res = await request(app.getHttpServer() as Server)
      [method.toLowerCase() as 'get' | 'post'](path)
      .send({ ids: [] });
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'NT-GEN-0002' });
    expect(Object.values(svc).every((f) => f.mock.calls.length === 0)).toBe(
      true,
    );
  });

  it('sai X-Internal-Token → 401', async () => {
    const res = await request(app.getHttpServer() as Server)
      .get('/internal/stats/users')
      .set('X-Internal-Token', 'sai');
    expect(res.status).toBe(401);
  });

  it('GET /internal/users/:id có token → 200', async () => {
    const res = await request(app.getHttpServer() as Server)
      .get(`/internal/users/${uuid(1)}`)
      .set('X-Internal-Token', TOKEN);
    expect(res.status).toBe(200);
    expect(svc.getUser).toHaveBeenCalledWith(uuid(1));
  });

  it('GET địa chỉ có token → gọi đúng userId, addressId', async () => {
    const res = await request(app.getHttpServer() as Server)
      .get(`/internal/users/${uuid(1)}/addresses/${uuid(2)}`)
      .set('X-Internal-Token', TOKEN);
    expect(res.status).toBe(200);
    expect(svc.getAddress).toHaveBeenCalledWith(uuid(1), uuid(2));
  });

  it('batch 100 id → 200', async () => {
    const ids = Array.from({ length: 100 }, (_, i) => uuid(i));
    const res = await request(app.getHttpServer() as Server)
      .post('/internal/users/batch')
      .set('X-Internal-Token', TOKEN)
      .send({ ids });
    expect(res.status).toBe(200);
    expect(svc.getUsers).toHaveBeenCalledWith(ids);
  });

  it('batch hơn 100 id → 400, không truy vấn', async () => {
    const ids = Array.from({ length: 101 }, (_, i) => uuid(i));
    const res = await request(app.getHttpServer() as Server)
      .post('/internal/users/batch')
      .set('X-Internal-Token', TOKEN)
      .send({ ids });
    expect(res.status).toBe(400);
    expect(svc.getUsers).not.toHaveBeenCalled();
  });

  it('batch id sai định dạng → 400', async () => {
    const res = await request(app.getHttpServer() as Server)
      .post('/internal/users/batch')
      .set('X-Internal-Token', TOKEN)
      .send({ ids: ['khong-phai-uuid'] });
    expect(res.status).toBe(400);
  });

  it('GET /internal/stats/users có token → 200', async () => {
    const res = await request(app.getHttpServer() as Server)
      .get('/internal/stats/users')
      .set('X-Internal-Token', TOKEN);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ total_users: 2 });
  });
});
