import { Module } from '@nestjs/common';
import { ClientsModule } from '../../clients/clients.module';
import { CatalogContextCache } from './catalog-context.cache';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

@Module({
  imports: [ClientsModule],
  controllers: [ChatController],
  providers: [ChatService, CatalogContextCache],
  exports: [ChatService], // ConversationModule dùng lại để sinh câu trả lời của trợ lý
})
export class ChatModule {}
