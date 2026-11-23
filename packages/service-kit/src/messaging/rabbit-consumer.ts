import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type {
  AmqpConnectionManager,
  ChannelWrapper,
} from 'amqp-connection-manager';
import type { ConfirmChannel, ConsumeMessage } from 'amqplib';
import {
  DLQ_EXCHANGE,
  EVENTS_EXCHANGE,
  RETRY_EXCHANGE,
  parseEnvelope,
  type EventEnvelope,
} from './envelope';
import { PoisonMessageError } from './errors';
import { connectRabbit } from './rabbit-connection';

// Nhận sự kiện, thử lại qua hàng đợi chờ, đưa vào DLQ (NT.MESSAGING Component_Class_Design §4,
// Processing_Flow §2–3). Khai báo topology khi khởi động.

export interface RabbitConsumerOptions {
  /** Rỗng: không nhận sự kiện, API đọc vẫn chạy */
  url: string;
  /** Hàng đợi chính, ví dụ `notification.events`. Hàng đợi thử lại, lỗi: thêm `.retry`, `.dlq` */
  queue: string;
  /** Routing key lấy từ `nextech.events`, ví dụ `order.*` */
  bindings: string[];
  prefetch: number;
  maxAttempts: number;
  retryDelayMs: number;
}

export type ConsumeOutcome = 'ack' | 'retry' | 'dlq';

/** Phần của ChannelWrapper mà consumer dùng — test thay bằng bản giả */
export type ConsumerChannel = Pick<ChannelWrapper, 'ack' | 'nack' | 'publish'>;

interface XDeath {
  queue?: string;
  count?: number;
}

export abstract class RabbitConsumer implements OnModuleInit, OnModuleDestroy {
  protected readonly logger: Logger;
  private conn?: AmqpConnectionManager;
  private channel?: ChannelWrapper;

  constructor(protected readonly opts: RabbitConsumerOptions) {
    this.logger = new Logger(`RabbitConsumer:${opts.queue}`);
  }

  /** Ném RetryableError (hoặc lỗi bất kỳ) để thử lại, PoisonMessageError để vào DLQ ngay. */
  protected abstract handle(message: EventEnvelope): Promise<void>;

  onModuleInit(): void {
    if (!this.opts.url) {
      this.logger.warn('Không có RABBITMQ_URL: không nhận sự kiện');
      return;
    }
    const conn = connectRabbit(this.opts.url, this.opts.queue, this.logger);
    this.conn = conn;
    const channel: ChannelWrapper = conn.createChannel({
      confirm: true,
      setup: async (ch: ConfirmChannel) => {
        await this.assertTopology(ch);
        await ch.prefetch(this.opts.prefetch);
        await ch.consume(this.opts.queue, (msg) => {
          if (msg) void this.processMessage(msg, channel);
        });
      },
    });
    this.channel = channel;
  }

  async onModuleDestroy(): Promise<void> {
    await this.conn?.close().catch(() => undefined);
  }

  isConnected(): boolean {
    return this.conn?.isConnected() ?? false;
  }

  /** Topology đủ 3 exchange, 3 hàng đợi (NT.MESSAGING API_Spec §1) */
  async assertTopology(ch: ConfirmChannel): Promise<void> {
    const { queue } = this.opts;
    await ch.assertExchange(EVENTS_EXCHANGE, 'topic', { durable: true });
    await ch.assertExchange(RETRY_EXCHANGE, 'topic', { durable: true });
    await ch.assertExchange(DLQ_EXCHANGE, 'fanout', { durable: true });

    await ch.assertQueue(queue, {
      durable: true,
      deadLetterExchange: RETRY_EXCHANGE,
    });
    for (const key of this.opts.bindings) {
      await ch.bindQueue(queue, EVENTS_EXCHANGE, key);
    }
    await ch.assertQueue(`${queue}.retry`, {
      durable: true,
      messageTtl: this.opts.retryDelayMs,
      deadLetterExchange: EVENTS_EXCHANGE,
    });
    await ch.bindQueue(`${queue}.retry`, RETRY_EXCHANGE, '#');
    await ch.assertQueue(`${queue}.dlq`, { durable: true });
    await ch.bindQueue(`${queue}.dlq`, DLQ_EXCHANGE, '');
  }

  /** Số lần đã xử lý lỗi trước lần này, đọc từ x-death của hàng đợi chính */
  previousAttempts(msg: ConsumeMessage): number {
    const deaths = (msg.properties.headers?.['x-death'] ?? []) as XDeath[];
    const d = deaths.find((x) => x.queue === this.opts.queue);
    return Number(d?.count ?? 0);
  }

  /** Xử lý một tin, luôn ack hoặc nack đúng một lần. Trả kết quả để test và log. */
  async processMessage(
    msg: ConsumeMessage,
    ch: ConsumerChannel,
  ): Promise<ConsumeOutcome> {
    const key = msg.fields.routingKey;
    const attempt = this.previousAttempts(msg) + 1;
    let envelope: EventEnvelope;
    try {
      envelope = parseEnvelope(msg.content);
    } catch (err) {
      return this.toDlq(msg, ch, err, attempt);
    }

    try {
      await this.handle(envelope);
      ch.ack(msg);
      return 'ack';
    } catch (err) {
      if (err instanceof PoisonMessageError) {
        return this.toDlq(msg, ch, err, attempt);
      }
      if (attempt >= this.opts.maxAttempts) {
        return this.toDlq(msg, ch, err, attempt);
      }
      this.logger.warn(
        `${key} ${envelope.event_id} lỗi lần ${attempt}, thử lại sau ${this.opts.retryDelayMs}ms: ${errMessage(err)}`,
      );
      // requeue=false: dead-letter sang nextech.retry, chờ TTL rồi về nextech.events
      ch.nack(msg, false, false);
      return 'retry';
    }
  }

  private async toDlq(
    msg: ConsumeMessage,
    ch: ConsumerChannel,
    err: unknown,
    attempt: number,
  ): Promise<ConsumeOutcome> {
    const reason = errMessage(err);
    this.logger.error(
      `${msg.fields.routingKey} vào DLQ sau ${attempt} lần: ${reason}`,
    );
    // Bỏ x-death: header có kiểu dữ liệu đặc biệt, giữ lại số lần trong x-attempts
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { 'x-death': _death, ...headers } = (msg.properties.headers ??
      {}) as Record<string, unknown>;
    try {
      await ch.publish(DLQ_EXCHANGE, msg.fields.routingKey, msg.content, {
        persistent: true,
        messageId: msg.properties.messageId as string | undefined,
        contentType: msg.properties.contentType as string | undefined,
        headers: {
          ...headers,
          'x-error': reason.slice(0, 500),
          'x-failed-at': new Date().toISOString(),
          'x-attempts': attempt,
          'x-original-routing-key': msg.fields.routingKey,
        },
      });
    } catch (pubErr) {
      // Không đưa được vào DLQ: trả lại hàng đợi thử lại, không mất tin
      this.logger.error(`Không gửi được vào DLQ: ${errMessage(pubErr)}`);
      ch.nack(msg, false, false);
      return 'retry';
    }
    ch.ack(msg);
    return 'dlq';
  }
}

function errMessage(err: unknown): string {
  return (err as Error)?.message ?? String(err);
}
