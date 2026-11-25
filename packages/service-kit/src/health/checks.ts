import type { ModuleRef } from '@nestjs/core';
import { DataSource } from 'typeorm';

// Một kiểm tra phụ thuộc của riêng service (reliability-standard §6).
// Không kiểm tra service khác, để một service chết không kéo cả chuỗi bị coi là chết.
export interface HealthCheck {
  name: string;
  /** Mặc định true: lỗi thì /health trả 503. false: chỉ báo trạng thái. */
  required?: boolean;
  check: (moduleRef: ModuleRef) => Promise<unknown>;
}

export function typeOrmHealthCheck(): HealthCheck {
  return {
    name: 'db',
    check: (ref) => ref.get(DataSource, { strict: false }).query('SELECT 1'),
  };
}

/**
 * `token`: provider có `isConnected()` (OutboxPublisher, RabbitConsumer). Mặc định không bắt buộc:
 * RabbitMQ chết không làm service bị coi là chết (NT.MESSAGING, PHASE-4 T4.1).
 */
export function rabbitHealthCheck(token: unknown): HealthCheck {
  return {
    name: 'rabbitmq',
    required: false,
    check: async (ref) => {
      const p = ref.get<{ isConnected(): boolean }>(token as string, {
        strict: false,
      });
      if (!p.isConnected()) throw new Error('rabbitmq disconnected');
    },
  };
}

/** `token`: provider của client Redis trong service (ioredis), ví dụ 'REDIS_CLIENT'. */
export function redisHealthCheck(token: string | symbol): HealthCheck {
  return {
    name: 'redis',
    check: (ref) =>
      ref.get<{ ping(): Promise<string> }>(token, { strict: false }).ping(),
  };
}
