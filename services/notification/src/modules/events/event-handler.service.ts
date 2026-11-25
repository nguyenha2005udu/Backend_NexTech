import { Injectable, Logger } from '@nestjs/common';
import {
  RetryableError,
  UpstreamBusinessError,
  type EventEnvelope,
} from '@nextech/service-kit';
import { DataSource } from 'typeorm';
import { IdentityClient } from '../../clients/identity.client';
import { Notification } from '../../database/entities/notification.entity';
import { ProcessedEvent } from '../../database/entities/processed-event.entity';
import { MailService } from '../../mail/mail.service';
import { buildTemplate } from './message-templates';

export type ProcessResult = 'processed' | 'duplicate';

// Idempotent qua processed_events + tạo thông báo (NT.NOTIFICATION Component_Class_Design §4).
// Email nằm trong transaction là ngoại lệ có chủ đích: gửi lỗi thì rollback cả thông báo và thử lại toàn bộ
// (NT.MESSAGING Processing_Flow §2) — mất thông báo tệ hơn trùng email.
@Injectable()
export class EventHandlerService {
  private readonly logger = new Logger(EventHandlerService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly identity: IdentityClient,
    private readonly mail: MailService,
  ) {}

  async process(event: EventEnvelope): Promise<ProcessResult> {
    const template = buildTemplate(event); // sự kiện lạ, thiếu trường: PoisonMessageError
    return this.dataSource.transaction(async (m) => {
      // INSERT ... ON CONFLICT DO NOTHING RETURNING: không trả dòng nào là bản trùng
      const r = await m
        .createQueryBuilder()
        .insert()
        .into(ProcessedEvent)
        .values({ event_id: event.event_id, event_type: event.type })
        .orIgnore()
        .returning(['event_id'])
        .execute();
      if (!(r.raw as unknown[]).length) return 'duplicate';

      await m.insert(Notification, template.notification);

      if (template.email) {
        await this.sendEmail(template.notification.user_id, template.email);
      }
      if (template.smsUnsupported) {
        this.logger.log(
          `Theo dõi giá kênh sms: chưa hỗ trợ SMS, chỉ tạo thông báo (${event.event_id})`,
        );
      }
      return 'processed';
    });
  }

  private async sendEmail(
    userId: string,
    e: { productName: string; currentPrice: number; targetPrice: number },
  ): Promise<void> {
    let email: string | undefined;
    try {
      email = (await this.identity.getUser(userId)).email;
    } catch (err) {
      // Người dùng không còn: không có ai để gửi, giữ thông báo, không thử lại
      if (err instanceof UpstreamBusinessError && err.getStatus() === 404) {
        this.logger.warn(`Người dùng ${userId} không còn, bỏ qua email`);
        return;
      }
      throw new RetryableError(
        `Không lấy được email người nhận: ${(err as Error)?.message ?? String(err)}`,
      );
    }
    if (!email) return;
    try {
      await this.mail.sendPriceAlertTriggered(
        email,
        e.productName,
        e.currentPrice,
        e.targetPrice,
      );
    } catch (err) {
      // Không log địa chỉ người nhận (security-policy §5)
      throw new RetryableError(
        `Gửi email lỗi: ${(err as Error)?.message ?? String(err)}`,
      );
    }
  }
}
