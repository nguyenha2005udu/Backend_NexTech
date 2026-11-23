// Client Redis của order (NT.ORDER_HOLD v1.3 Component_Class_Design §1, §2; ADR-0015). Viết trong order, không chép
// cấu hình của identity (mặc định ioredis xếp hàng lệnh khi mất kết nối → request treo theo Redis). Ở đây mọi lệnh
// lỗi nhanh để khoá đơn fail-open được: mất kết nối thì lỗi ngay, Redis treo thì lỗi sau REDIS_COMMAND_TIMEOUT_MS.
// DB 1 tách khỏi key của identity (DB 0).
import {
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { RedisConfig } from '../config/configuration';
import { OrderLockService } from './order-lock.service';

/** Provider client ioredis của order; /health dùng redisHealthCheck(ORDER_REDIS) */
export const ORDER_REDIS = 'ORDER_REDIS';

export function createOrderRedis(cfg: RedisConfig): Redis {
  return new Redis({
    host: cfg.host,
    port: cfg.port,
    password: cfg.password,
    ...(cfg.tls ? { tls: {} } : {}),
    db: cfg.db,
    enableOfflineQueue: false, // mất kết nối: lệnh lỗi ngay, không xếp hàng
    maxRetriesPerRequest: 1,
    commandTimeout: cfg.commandTimeoutMs, // Redis treo (pause) vẫn lỗi nhanh
    connectTimeout: cfg.connectTimeoutMs,
    retryStrategy: (n: number) => Math.min(n * 200, 2000), // kết nối lại nền, không chặn request
  });
}

// Đóng kết nối khi tắt service
@Injectable()
class OrderRedisCloser implements OnModuleDestroy {
  constructor(@Inject(ORDER_REDIS) private readonly redis: Redis) {}
  onModuleDestroy() {
    this.redis.disconnect();
  }
}

const logger = new Logger('OrderRedis');

@Global()
@Module({
  providers: [
    {
      provide: ORDER_REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const client = createOrderRedis(
          config.getOrThrow<RedisConfig>('redis'),
        );
        // Không để lỗi kết nối thành unhandled 'error' event; chỉ log khi đổi trạng thái để không ngập log
        let down = false;
        client.on('error', (err: Error) => {
          if (!down) logger.warn(`Redis lỗi: ${err.message}`);
          down = true;
        });
        client.on('ready', () => {
          if (down) logger.log('Redis kết nối lại');
          down = false;
        });
        return client;
      },
    },
    OrderRedisCloser,
    OrderLockService,
  ],
  exports: [ORDER_REDIS, OrderLockService],
})
export class RedisModule {}
