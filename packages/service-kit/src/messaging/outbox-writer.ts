import { randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { currentRequestId } from '../context/request-context';
import type { EventEnvelope } from './envelope';
import { OutboxEvent } from './outbox.entity';

// Ghi sự kiện bằng EntityManager của transaction đang mở: dữ liệu và sự kiện cùng commit hoặc
// cùng mất (NT.MESSAGING Component_Class_Design §2).
export class OutboxWriter {
  constructor(private readonly source: string) {}

  async enqueue<T extends object>(
    manager: EntityManager,
    routingKey: string,
    data: T,
  ): Promise<EventEnvelope<T>> {
    const envelope: EventEnvelope<T> = {
      event_id: randomUUID(),
      type: routingKey,
      version: 1,
      occurred_at: new Date().toISOString(),
      source: this.source,
      request_id: currentRequestId() ?? null,
      data,
    };
    await manager.insert(OutboxEvent, {
      id: envelope.event_id,
      routing_key: routingKey,
      payload: envelope,
    });
    return envelope;
  }
}
