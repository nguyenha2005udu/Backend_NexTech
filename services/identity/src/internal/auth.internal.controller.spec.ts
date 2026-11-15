import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AllExceptionsFilter, BusinessException } from '@nextech/service-kit';
import request from 'supertest';
import type { Server } from 'node:http';
import { AuthService } from '../modules/auth/auth.service';
import { AuthInternalController } from './auth.internal.controller';

// POST /internal/auth/refresh (NT.IDENTITY API_Spec §2) — gateway gọi để refresh hộ client.

const TOKEN = 'test-internal-token';

describe('AuthInternalController', () => {
  let app: INestApplication;
  const auth = { verifyAndRefresh: jest.fn() };

  beforeAll(async () => {
    process.env.INTERNAL_API_TOKEN = TOKEN;
    const mod = await Test.createTestingModule({
      controllers: [AuthInternalController],
      providers: [{ provide: AuthService, useValue: auth }],
    }).compile();
    app = mod.createNestApplication();
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
  beforeEach(() => jest.resetAllMocks());

  const post = (body: object, token?: string) => {
    const r = request(app.getHttpServer() as Server).post(
      '/internal/auth/refresh',
    );
    if (token) r.set('X-Internal-Token', token);
    return r.send(body);
  };

  it('không có X-Internal-Token → 401, không refresh', async () => {
    const res = await post({ refresh_token: 'x' });
    expect(res.status).toBe(401);
    expect(auth.verifyAndRefresh).not.toHaveBeenCalled();
  });

  it('thành công → 200 với body cho gateway', async () => {
    const out = {
      access_token: 'a',
      refresh_token: 'r',
      access_ttl_s: 900,
      refresh_ttl_s: 604800,
      user: { sub: 'u1', email: 'a@b.c', role: 'user' },
    };
    auth.verifyAndRefresh.mockResolvedValue(out);
    const res = await post({ refresh_token: 'old' }, TOKEN);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(out);
    expect(auth.verifyAndRefresh).toHaveBeenCalledWith('old');
  });

  it('thiếu refresh_token → 400', async () => {
    const res = await post({}, TOKEN);
    expect(res.status).toBe(400);
    expect(auth.verifyAndRefresh).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'NT-IDN-1001'],
    [403, 'NT-IDN-1002'],
  ])('AuthService ném %d → trả đúng status và mã', async (status, code) => {
    auth.verifyAndRefresh.mockRejectedValue(
      new BusinessException(status, code, 'x'),
    );
    const res = await post({ refresh_token: 'old' }, TOKEN);
    expect(res.status).toBe(status);
    expect(res.body).toMatchObject({ code });
  });
});
