import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClientsModule } from '../../clients/clients.module';
import { Conversation } from '../../database/entities/conversation.entity';
import { Message } from '../../database/entities/message.entity';
import { ConversationAdminController } from './conversation.admin.controller';
import { ConversationAdminService } from './conversation.admin.service';

@Module({
  imports: [TypeOrmModule.forFeature([Conversation, Message]), ClientsModule],
  controllers: [ConversationAdminController],
  providers: [ConversationAdminService],
})
export class ConversationAdminModule {}
