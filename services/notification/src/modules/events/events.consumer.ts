import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  RabbitConsumer,
  type EventEnvelope,
  type MessagingConfig,
} from '@nextech/service-kit';
import { EventHandlerService } from './event-handler.service';

// Nhận order.*, price.alert.* từ nextech.events (NT.MESSAGING API_Spec §1). Thử lại, DLQ: RabbitConsumer.
@Injectable()
export class EventsConsumer extends RabbitConsumer {
  constructor(
    private readonly handler: EventHandlerService,
    config: ConfigService,
  ) {
    const c = config.getOrThrow<MessagingConfig>('messaging');
    super({
      url: c.url,
      queue: 'notification.events',
      bindings: ['order.*', 'price.alert.*'],
      prefetch: c.prefetch,
      maxAttempts: c.maxAttempts,
      retryDelayMs: c.retryDelayMs,
    });
  }

  protected async handle(message: EventEnvelope): Promise<void> {
    const r = await this.handler.process(message);
    if (r === 'duplicate') {
      this.logger.log(`${message.type} ${message.event_id}: bản trùng, bỏ qua`);
    }
  }
}
