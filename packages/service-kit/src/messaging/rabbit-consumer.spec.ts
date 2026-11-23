import type { ConsumeMessage } from 'amqplib';
import { DLQ_EXCHANGE, type EventEnvelope } from './envelope';
import { PoisonMessageError, RetryableError } from './errors';
import { RabbitConsumer, type ConsumerChannel } from './rabbit-consumer';

// NT.MESSAGING Component_Class_Design §5: thử lại, DLQ, message hỏng, ack đúng một lần.

class TestConsumer extends RabbitConsumer {
  handled: EventEnvelope[] = [];
  behavior: () => Promise<void> = () => Promise.resolve();
  protected async handle(m: EventEnvelope): Promise<void> {
    this.handled.push(m);
    await this.behavior();
  }
}

const OPTS = {
  url: '',
  queue: 'notification.events',
  bindings: ['order.*'],
  prefetch: 10,
  maxAttempts: 3,
  retryDelayMs: 5000,
};

const EVENT = {
  event_id: '0a6c8f1e-7a58-4a1b-9e3a-6a4ad4b0a4c1',
  type: 'order.created',
  version: 1,
  occurred_at: '2026-11-04T10:00:00.000Z',
  source: 'order',
  request_id: null,
  data: { order_id: 'x' },
};

function msg(content: string, deaths?: number): ConsumeMessage {
  return {
    content: Buffer.from(content),
    fields: { routingKey: 'order.created' },
    properties: {
      messageId: EVENT.event_id,
      contentType: 'application/json',
      headers:
        deaths === undefined
          ? {}
          : {
              'x-death': [
                { queue: 'other.queue', count: 9 },
                { queue: 'notification.events', count: deaths },
              ],
            },
    },
  } as unknown as ConsumeMessage;
}

function channel(): jest.Mocked<ConsumerChannel> {
  return {
    ack: jest.fn(),
    nack: jest.fn(),
    publish: jest.fn().mockResolvedValue(true),
  };
}

describe('RabbitConsumer.processMessage', () => {
  let c: TestConsumer;
  let ch: jest.Mocked<ConsumerChannel>;
  beforeEach(() => {
    c = new TestConsumer(OPTS);
    ch = channel();
  });

  it('thành công: ack, không DLQ', async () => {
    await expect(
      c.processMessage(msg(JSON.stringify(EVENT)), ch),
    ).resolves.toBe('ack');
    expect(ch.ack).toHaveBeenCalledTimes(1);
    expect(ch.nack).not.toHaveBeenCalled();
    expect(c.handled[0].event_id).toBe(EVENT.event_id);
  });

  it('không phải JSON: vào DLQ ngay, không gọi handle, không thử lại', async () => {
    await expect(c.processMessage(msg('khong-phai-json'), ch)).resolves.toBe(
      'dlq',
    );
    expect(c.handled).toHaveLength(0);
    expect(ch.nack).not.toHaveBeenCalled();
    expect(ch.ack).toHaveBeenCalledTimes(1);
    const [ex, key, , opts] = ch.publish.mock.calls[0] as unknown as [
      string,
      string,
      unknown,
      { headers: Record<string, unknown> },
    ];
    expect(ex).toBe(DLQ_EXCHANGE);
    expect(key).toBe('order.created');
    expect(opts.headers['x-error']).toContain('JSON');
    expect(opts.headers['x-failed-at']).toBeDefined();
  });

  it('thiếu trường bắt buộc: vào DLQ ngay', async () => {
    await expect(
      c.processMessage(msg(JSON.stringify({ type: 'order.created' })), ch),
    ).resolves.toBe('dlq');
  });

  it('PoisonMessageError từ handle: vào DLQ ngay ở lần đầu', async () => {
    c.behavior = () => Promise.reject(new PoisonMessageError('sự kiện lạ'));
    await expect(
      c.processMessage(msg(JSON.stringify(EVENT)), ch),
    ).resolves.toBe('dlq');
  });

  it('lỗi tạm thời: lần 1, 2 nack(requeue=false); lần 3 vào DLQ — đúng 3 lần xử lý', async () => {
    c.behavior = () => Promise.reject(new RetryableError('smtp lỗi'));
    const results = [];
    for (const deaths of [undefined, 1, 2]) {
      results.push(
        await c.processMessage(msg(JSON.stringify(EVENT), deaths), ch),
      );
    }
    expect(results).toEqual(['retry', 'retry', 'dlq']);
    expect(c.handled).toHaveLength(3);
    expect(ch.nack).toHaveBeenCalledTimes(2);
    expect(ch.nack).toHaveBeenCalledWith(expect.anything(), false, false);
    expect(ch.ack).toHaveBeenCalledTimes(1);
    const { headers } = ch.publish.mock.calls[0][3] as {
      headers: Record<string, unknown>;
    };
    expect(headers?.['x-death']).toBeUndefined();
    expect(headers?.['x-attempts']).toBe(3);
  });

  it('đếm x-death đúng hàng đợi chính', () => {
    expect(c.previousAttempts(msg('{}', 2))).toBe(2);
    expect(c.previousAttempts(msg('{}'))).toBe(0);
  });

  it('không publish được vào DLQ: nack để không mất tin', async () => {
    (ch.publish as jest.Mock).mockRejectedValueOnce(new Error('closed'));
    await expect(c.processMessage(msg('x'), ch)).resolves.toBe('retry');
    expect(ch.ack).not.toHaveBeenCalled();
    expect(ch.nack).toHaveBeenCalledTimes(1);
  });

  it('không có RABBITMQ_URL: khởi động không lỗi, chưa kết nối', () => {
    c.onModuleInit();
    expect(c.isConnected()).toBe(false);
  });
});
