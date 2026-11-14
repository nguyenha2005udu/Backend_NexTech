import { Global, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

// Provider client ioredis cho /health (service-kit#redisHealthCheck)
export const REDIS_CLIENT = 'REDIS_CLIENT';

// Chép từ be/src/config/redis.ts
@Injectable()
export class RedisService implements OnModuleDestroy {
  public readonly client: Redis;

  constructor(private config: ConfigService) {
    const useTls = this.config.get('redis.tls') === true;

    this.client = new Redis({
      host: this.config.get('redis.host'),
      port: Number(this.config.get('redis.port')),
      password: this.config.get('redis.password') || undefined,
      ...(useTls ? { tls: {} } : {}), // Upstash bắt buộc TLS, Redis local thì không cần
    });
  }

  async set(key: string, value: string, ttlSeconds?: number) {
    if (ttlSeconds) {
      await this.client.set(key, value, 'EX', ttlSeconds);
    } else {
      await this.client.set(key, value);
    }
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async del(key: string) {
    await this.client.del(key);
  }

  onModuleDestroy() {
    this.client.disconnect();
  }
}

@Global()
@Module({
  providers: [
    RedisService,
    {
      provide: REDIS_CLIENT,
      useFactory: (redis: RedisService) => redis.client,
      inject: [RedisService],
    },
  ],
  exports: [RedisService, REDIS_CLIENT],
})
export class RedisModule {}
