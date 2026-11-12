import {
  Body,
  Controller,
  Get,
  INestApplication,
  Logger,
  Module,
  Post,
} from '@nestjs/common';
import { IsString } from 'class-validator';
import request from 'supertest';
import { bootstrapService } from './bootstrap';
import { BusinessException } from './errors/business.exception';
import { HealthModule } from './health/health.module';

class CreateDto {
  @IsString()
  name: string;
}

@Controller('internal/ping')
class InternalPingController {
  @Get()
  ping() {
    return { pong: true };
  }
}

@Controller('orders')
class OrdersController {
  @Get()
  list() {
    return [];
  }

  @Post()
  create(@Body() dto: CreateDto) {
    return dto;
  }

  @Get('fail')
  fail() {
    throw new BusinessException(409, 'NT-ORD-1001', 'Đơn đang được xử lý');
  }
}

@Module({
  imports: [HealthModule.forRoot({ service: 'demo', checks: [] })],
  controllers: [InternalPingController, OrdersController],
})
class DemoAppModule {}

let app: INestApplication;
let http: ReturnType<typeof request>;

beforeAll(async () => {
  Logger.overrideLogger(false);
  app = await bootstrapService(DemoAppModule, { name: 'demo', port: 0 });
  http = request(await app.getUrl());
});

afterAll(async () => {
  await app.close();
  Logger.overrideLogger(['log', 'error', 'warn']);
});

describe('bootstrapService (app thử)', () => {
  it('/health trả 200, không qua prefix /api', async () => {
    expect((await http.get('/health')).status).toBe(200);
    expect((await http.get('/api/health')).status).toBe(404);
  });

  it('/internal/* không qua prefix /api', async () => {
    expect((await http.get('/internal/ping')).body).toEqual({ pong: true });
    expect((await http.get('/api/internal/ping')).status).toBe(404);
  });

  it('route khác có prefix /api', async () => {
    expect((await http.get('/api/orders')).status).toBe(200);
    expect((await http.get('/orders')).status).toBe(404);
  });

  it('trả X-Request-ID, giữ giá trị gửi lên', async () => {
    const res = await http.get('/api/orders').set('X-Request-ID', 'rid-42');
    expect(res.headers['x-request-id']).toBe('rid-42');
  });

  it('lỗi đi qua AllExceptionsFilter: có code và request_id', async () => {
    const res = await http.get('/api/orders/fail').set('X-Request-ID', 'rid-7');

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: 'NT-ORD-1001',
      request_id: 'rid-7',
    });
  });

  it('ValidationPipe như monolith: trường lạ bị từ chối, 400 NT-GEN-0001', async () => {
    const res = await http.post('/api/orders').send({ name: 'a', hack: 1 });

    expect(res.status).toBe(400);
    const body = res.body as { code: string; message: unknown };
    expect(body.code).toBe('NT-GEN-0001');
    expect(Array.isArray(body.message)).toBe(true);
  });

  it('không bật CORS ở service (gateway lo)', async () => {
    const res = await http
      .get('/api/orders')
      .set('Origin', 'http://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
