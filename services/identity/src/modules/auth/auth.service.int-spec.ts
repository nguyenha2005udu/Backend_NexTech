import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { BusinessException } from '@nextech/service-kit';
import { randomUUID } from 'node:crypto';
import type { Repository } from 'typeorm';
import type { User } from '../../database/entities/user.entity';
import type { MailService } from '../../mail/mail.service';
import { RedisService } from '../../redis/redis.module';
import { AuthService } from './auth.service';

// Redis thật (tdd-guide §5: test đồng thời không dùng mock). Cần `docker compose up -d redis`
// (cổng 127.0.0.1:6380). Chạy: npm run test:int -w services/identity
// Khoá dùng tiền tố ngẫu nhiên qua mã OAuth sinh mới, không đụng dữ liệu dev.

const config = new ConfigService({
  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6380),
  },
  jwt: { accessSecret: 'a', refreshSecret: 'r' },
});

describe('AuthService + Redis thật', () => {
  let redis: RedisService;
  let service: AuthService;
  const user = { id: randomUUID(), is_active: true } as User;

  beforeAll(() => {
    redis = new RedisService(config);
    service = new AuthService(
      {
        findOne: jest.fn().mockResolvedValue(user),
      } as unknown as Repository<User>,
      new JwtService({}),
      config,
      redis,
      {} as MailService,
    );
  });

  afterAll(() => redis.onModuleDestroy());

  it('oauth/exchange: 10 lời gọi đồng thời cùng mã → đúng 1 thành công, 9 lần 401 NT-IDN-1011', async () => {
    const code = await service.createOAuthCode(user.id);

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => service.exchangeOAuthCode(code)),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );
    expect(rejected).toHaveLength(9);
    for (const r of rejected) {
      expect(r.reason).toBeInstanceOf(BusinessException);
      expect((r.reason as BusinessException).code).toBe('NT-IDN-1011');
    }
    // Mã đã bị xoá
    expect(await redis.get(`oauth_code:${code}`)).toBeNull();
  });

  it('mã hết TTL 60 giây được Redis đặt đúng', async () => {
    const code = await service.createOAuthCode(user.id);
    const ttl = await redis.client.ttl(`oauth_code:${code}`);
    expect(ttl).toBeGreaterThan(55);
    expect(ttl).toBeLessThanOrEqual(60);
    await redis.del(`oauth_code:${code}`);
  });
});
