import { Module } from '@nestjs/common';
import { ClientsModule } from '../../clients/clients.module';
import { MailModule } from '../../mail/mail.module';
import { EventHandlerService } from './event-handler.service';
import { EventsConsumer } from './events.consumer';

@Module({
  imports: [ClientsModule, MailModule],
  providers: [EventHandlerService, EventsConsumer],
  exports: [EventsConsumer],
})
export class EventsModule {}
