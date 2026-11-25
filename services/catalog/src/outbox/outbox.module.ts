import { Module } from '@nestjs/common';
import { messagingConfig, OutboxPublisher } from '@nextech/service-kit';
import { DataSource } from 'typeorm';

// Gửi sự kiện trong bảng outbox sang RabbitMQ (T4.1, T4.4, NT.MESSAGING Component_Class_Design §3).
// RabbitMQ chết: cron theo dõi giá vẫn chạy, sự kiện nằm chờ, nối lại thì gửi hết.
@Module({
  providers: [
    {
      provide: OutboxPublisher,
      inject: [DataSource],
      useFactory: (ds: DataSource) => {
        const c = messagingConfig();
        return new OutboxPublisher(ds, {
          source: 'catalog',
          url: c.url,
          pollMs: c.pollMs,
          batch: c.batch,
          retentionDays: c.retentionDays,
        });
      },
    },
  ],
  exports: [OutboxPublisher],
})
export class OutboxModule {}
