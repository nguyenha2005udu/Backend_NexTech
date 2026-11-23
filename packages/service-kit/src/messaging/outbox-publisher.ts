import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type {
  AmqpConnectionManager,
  ChannelWrapper,
} from 'amqp-connection-manager';
import type { ConfirmChannel } from 'amqplib';
import { DataSource, IsNull, LessThan } from 'typeorm';
import { EVENTS_EXCHANGE } from './envelope';
import { OutboxEvent } from './outbox.entity';
import { connectRabbit } from './rabbit-connection';

// Định kỳ đọc dòng outbox chưa gửi, publish có confirm, đánh dấu đã gửi (NT.MESSAGING
// Component_Class_Design §3). Giao ít nhất một lần: chết giữa publish và update thì gửi lại,
// consumer đã chống trùng.

export interface OutboxPublisherOptions {
  /** Tên service, dùng cho log và tên kết nối */
  source: string;
  /** Rỗng: không publish, sự kiện nằm chờ trong bảng */
  url: string;
  pollMs: number;
  batch: number;
  retentionDays: number;
}

/** Phần của ChannelWrapper mà publisher dùng — test thay bằng bản giả */
export type PublisherChannel = Pick<ChannelWrapper, 'publish'>;

const PUBLISH_TIMEOUT_MS = 5000;
const CLEANUP_EVERY_MS = 6 * 60 * 60 * 1000;

export class OutboxPublisher implements OnModuleInit, OnModuleDestroy {
  private readonly logger: Logger;
  private conn?: AmqpConnectionManager;
  private channel?: PublisherChannel;
  private connected: () => boolean;
  private timers: NodeJS.Timeout[] = [];
  private running = false;

  constructor(
    private readonly ds: DataSource,
    private readonly opts: OutboxPublisherOptions,
    /** Chỉ dùng trong test */
    testChannel?: { channel: PublisherChannel; connected: () => boolean },
  ) {
    this.logger = new Logger(`OutboxPublisher:${opts.source}`);
    this.channel = testChannel?.channel;
    this.connected = testChannel?.connected ?? (() => false);
  }

  onModuleInit(): void {
    if (!this.channel) {
      if (!this.opts.url) {
        this.logger.warn('Không có RABBITMQ_URL: sự kiện chỉ nằm trong outbox');
        return;
      }
      const conn = connectRabbit(
        this.opts.url,
        `${this.opts.source}-outbox`,
        this.logger,
      );
      this.conn = conn;
      this.channel = conn.createChannel({
        confirm: true,
        publishTimeout: PUBLISH_TIMEOUT_MS,
        setup: (ch: ConfirmChannel) =>
          ch.assertExchange(EVENTS_EXCHANGE, 'topic', { durable: true }),
      });
      this.connected = () => conn.isConnected();
    }
    this.timers.push(
      setInterval(() => void this.tick(), this.opts.pollMs),
      setInterval(() => void this.cleanup(), CLEANUP_EVERY_MS),
    );
    void this.cleanup();
  }

  async onModuleDestroy(): Promise<void> {
    this.timers.forEach((t) => clearInterval(t));
    this.timers = [];
    await this.conn?.close().catch(() => undefined);
  }

  /** Cho health check (không bắt buộc) */
  isConnected(): boolean {
    return this.connected();
  }

  /** Một lượt gửi. Trả số dòng đã gửi. Lỗi giữa chừng: dừng lượt này, lượt sau gửi tiếp. */
  async tick(): Promise<number> {
    if (this.running || !this.channel || !this.connected()) return 0;
    this.running = true;
    const repo = this.ds.getRepository(OutboxEvent);
    let sent = 0;
    try {
      const rows = await repo.find({
        where: { published_at: IsNull() },
        order: { created_at: 'ASC' },
        take: this.opts.batch,
      });
      for (const row of rows) {
        try {
          // Confirm channel: chờ broker xác nhận rồi mới đánh dấu đã gửi
          await this.channel.publish(
            EVENTS_EXCHANGE,
            row.routing_key,
            Buffer.from(JSON.stringify(row.payload)),
            {
              persistent: true,
              messageId: row.id,
              contentType: 'application/json',
              timeout: PUBLISH_TIMEOUT_MS,
            },
          );
        } catch (err) {
          await repo.increment({ id: row.id }, 'attempts', 1);
          throw err;
        }
        await repo.update({ id: row.id }, { published_at: new Date() });
        sent++;
      }
    } catch (err) {
      this.logger.warn(
        `Outbox publish lỗi, thử lại ở lượt sau: ${(err as Error)?.message ?? String(err)}`,
      );
    } finally {
      this.running = false;
    }
    return sent;
  }

  /** Xoá dòng đã gửi quá OUTBOX_RETENTION_DAYS */
  async cleanup(): Promise<number> {
    try {
      const before = new Date(
        Date.now() - this.opts.retentionDays * 24 * 60 * 60 * 1000,
      );
      const r = await this.ds
        .getRepository(OutboxEvent)
        .delete({ published_at: LessThan(before) });
      return r.affected ?? 0;
    } catch (err) {
      this.logger.warn(
        `Dọn outbox lỗi: ${(err as Error)?.message ?? String(err)}`,
      );
      return 0;
    }
  }
}
