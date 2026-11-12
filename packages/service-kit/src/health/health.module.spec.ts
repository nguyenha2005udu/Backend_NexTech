import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { HealthModule } from './health.module';
import { HealthCheck, typeOrmHealthCheck } from './checks';

async function appWith(checks: HealthCheck[], dataSource?: unknown) {
  const moduleRef = await Test.createTestingModule({
    imports: [HealthModule.forRoot({ service: 'order', checks })],
    providers: dataSource
      ? [{ provide: DataSource, useValue: dataSource }]
      : [],
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  return app;
}

let app: INestApplication | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('HealthModule', () => {
  it('mọi kiểm tra bắt buộc đạt: 200, status ok, có uptime_s', async () => {
    const query = jest.fn().mockResolvedValue([{ '?column?': 1 }]);
    app = await appWith([typeOrmHealthCheck()], { query });

    const res = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    ).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'ok',
      service: 'order',
      uptime_s: expect.any(Number) as number,
      checks: { db: 'up' },
    });
    expect(query).toHaveBeenCalledWith('SELECT 1');
  });

  it('kiểm tra bắt buộc lỗi: 503, status down', async () => {
    app = await appWith([typeOrmHealthCheck()], {
      query: jest.fn().mockRejectedValue(new Error('db chết')),
    });

    const res = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    ).get('/health');

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ status: 'down', checks: { db: 'down' } });
  });

  it('kiểm tra không bắt buộc lỗi: vẫn 200, báo trạng thái', async () => {
    app = await appWith([
      { name: 'db', check: () => Promise.resolve() },
      {
        name: 'rabbitmq',
        required: false,
        check: () => Promise.reject(new Error('x')),
      },
    ]);

    const res = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    ).get('/health');

    expect(res.status).toBe(200);
    expect((res.body as { checks: unknown }).checks).toEqual({
      db: 'up',
      rabbitmq: 'down',
    });
  });

  it('kiểm tra treo quá 1 giây: tính là down', async () => {
    app = await appWith([
      { name: 'db', check: () => new Promise(() => undefined) },
    ]);

    const t0 = Date.now();
    const res = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    ).get('/health');

    expect(res.status).toBe(503);
    expect(Date.now() - t0).toBeLessThan(1500);
  });
});
