import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthModule, typeOrmHealthCheck } from '@nextech/service-kit';
import configuration from './config/configuration';
import { dataSourceOptions } from './database/typeorm-options';
import { ChatModule } from './modules/chat/chat.module';
import { ConversationModule } from './modules/conversation/conversation.module';

// Khung T1.6: khởi động, kết nối database, /health. T8.5: hội thoại. T8.6: gọi AI. T8.7: quản trị.
// Health chỉ kiểm db: FPT, catalog, identity chậm không có nghĩa service này chết (design/ASSISTANT/README.md §7).
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    // Chạy migration khi khởi động, không synchronize (coding-convention §5)
    TypeOrmModule.forRootAsync({
      useFactory: () => ({ ...dataSourceOptions(), migrationsRun: true }),
    }),
    HealthModule.forRoot({
      service: 'assistant',
      checks: [typeOrmHealthCheck()],
    }),
    ChatModule,
    ConversationModule,
  ],
})
export class AppModule {}
