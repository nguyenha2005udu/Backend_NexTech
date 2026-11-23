import type { DataSource, EntityManager } from 'typeorm';
import { parseEnvelope } from './envelope';
import { PoisonMessageError } from './errors';
import { OutboxEvent } from './outbox.entity';
import { OutboxPublisher, type PublisherChannel } from './outbox-publisher';
import { OutboxWriter } from './outbox-writer';
import { messagingConfig } from './config';

// NT.MESSAGING Component_Class_Design §5 (phần không cần broker thật): writer ghi bằng manager của
// transaction; RabbitMQ tắt thì dòng giữ nguyên; bật lại thì gửi hết.

describe('OutboxWriter', () => {
  it('ghi một dòng bằng EntityManager được truyền vào, payload là envelope đầy đủ', async () => {
    const insert = jest.fn().mockResolvedValue(undefined);
    const m = { insert } as unknown as EntityManager;
    const env = await new OutboxWriter('order').enqueue(m, 'order.paid', {
      order_id: 'o1',
    });
    expect(insert).toHaveBeenCalledWith(OutboxEvent, {
      id: env.event_id,
      routing_key: 'order.paid',
      payload: env,
    });
    expect(env).toMatchObject({
      type: 'order.paid',
      version: 1,
      source: 'order',
      data: { order_id: 'o1' },
    });
    // envelope ghi ra parse lại được (consumer không coi là hỏng)
    expect(parseEnvelope(JSON.stringify(env)).event_id).toBe(env.event_id);
  });

  it('enqueueMany: một câu INSERT cho cả lô, rỗng thì không truy vấn', async () => {
    const insert = jest.fn().mockResolvedValue(undefined);
    const m = { insert } as unknown as EntityManager;
    const w = new OutboxWriter('catalog');
    await expect(
      w.enqueueMany(m, 'price.alert.triggered', []),
    ).resolves.toEqual([]);
    expect(insert).not.toHaveBeenCalled();
    const envs = await w.enqueueMany(m, 'price.alert.triggered', [
      { alert_id: 'a' },
      { alert_id: 'b' },
    ]);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(new Set(envs.map((e) => e.event_id)).size).toBe(2);
  });

  it('insert lỗi (transaction rollback): lỗi truyền lên bên gọi', async () => {
    const m = {
      insert: jest.fn().mockRejectedValue(new Error('rollback')),
    } as unknown as EntityManager;
    await expect(
      new OutboxWriter('order').enqueue(m, 'order.paid', {}),
    ).rejects.toThrow('rollback');
  });
});

describe('parseEnvelope', () => {
  it('không phải JSON: PoisonMessageError', () => {
    expect(() => parseEnvelope('khong-phai-json')).toThrow(PoisonMessageError);
  });
});

function fakeRepo(rows: Partial<OutboxEvent>[]) {
  return {
    rows,
    find: jest.fn(() =>
      Promise.resolve(rows.filter((r) => r.published_at == null)),
    ),
    update: jest.fn((where: { id: string }, set: Partial<OutboxEvent>) => {
      Object.assign(
        rows.find((r) => r.id === where.id)!,
        set,
      );
      return Promise.resolve({ affected: 1 });
    }),
    increment: jest.fn(() => Promise.resolve({})),
    delete: jest.fn(() => Promise.resolve({ affected: 2 })),
  };
}

describe('OutboxPublisher.tick', () => {
  const opts = {
    source: 'order',
    url: '',
    pollMs: 2000,
    batch: 50,
    retentionDays: 7,
  };
  const rowsOf = () => [
    {
      id: 'a',
      routing_key: 'order.created',
      payload: { a: 1 },
      published_at: null,
    },
    {
      id: 'b',
      routing_key: 'order.paid',
      payload: { b: 1 },
      published_at: null,
    },
  ];

  function setup(connected: { value: boolean }, publish: jest.Mock) {
    const repo = fakeRepo(rowsOf());
    const ds = { getRepository: () => repo } as unknown as DataSource;
    const channel = { publish } as unknown as PublisherChannel;
    const p = new OutboxPublisher(ds, opts, {
      channel,
      connected: () => connected.value,
    });
    return { p, repo };
  }

  it('RabbitMQ tắt: không đọc, dòng giữ nguyên; bật lại: gửi hết theo thứ tự', async () => {
    const connected = { value: false };
    const publish = jest.fn().mockResolvedValue(true);
    const { p, repo } = setup(connected, publish);

    await expect(p.tick()).resolves.toBe(0);
    expect(publish).not.toHaveBeenCalled();
    expect(repo.rows.every((r) => r.published_at === null)).toBe(true);

    connected.value = true;
    await expect(p.tick()).resolves.toBe(2);
    expect(publish.mock.calls.map((c: unknown[]) => c[1] as string)).toEqual([
      'order.created',
      'order.paid',
    ]);
    expect((publish.mock.calls[0] as unknown[])[3]).toMatchObject({
      persistent: true,
      messageId: 'a',
      contentType: 'application/json',
    });
    expect(repo.rows.every((r) => r.published_at instanceof Date)).toBe(true);
  });

  it('publish lỗi giữa chừng: dòng lỗi tăng attempts, chưa đánh dấu, lượt sau gửi tiếp', async () => {
    const publish = jest
      .fn()
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error('nack'))
      .mockResolvedValue(true);
    const { p, repo } = setup({ value: true }, publish);

    await expect(p.tick()).resolves.toBe(1);
    expect(repo.increment).toHaveBeenCalledWith({ id: 'b' }, 'attempts', 1);
    expect(repo.rows[1].published_at).toBeNull();

    await expect(p.tick()).resolves.toBe(1);
    expect(repo.rows[1].published_at).toBeInstanceOf(Date);
  });

  it('cleanup xoá dòng đã gửi quá hạn', async () => {
    const { p, repo } = setup({ value: true }, jest.fn());
    await expect(p.cleanup()).resolves.toBe(2);
    expect(repo.delete).toHaveBeenCalledTimes(1);
  });
});

describe('messagingConfig', () => {
  it('mặc định theo API_Spec §6', () => {
    expect(messagingConfig({})).toMatchObject({
      url: '',
      pollMs: 2000,
      batch: 50,
      retentionDays: 7,
      maxAttempts: 3,
      prefetch: 10,
    });
  });
});
