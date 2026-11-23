import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ResilientHttpClient } from '@nextech/service-kit';
import type { AiConfig } from '../config/configuration';
import { SEARCH_PRODUCTS_TOOL } from '../modules/chat/system-prompt';
import { CatalogClient } from './catalog.client';
import { FptAiClient } from './fpt-ai.client';
import { IdentityClient } from './identity.client';

// Client tới service khác và FPT AI (design/ASSISTANT/README.md §3), mỗi client một ResilientHttpClient
// (mạch riêng theo đích). URL lấy từ env (architecture §8). Khuôn: order/src/clients.
@Module({
  providers: [
    {
      provide: CatalogClient,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new CatalogClient(
          new ResilientHttpClient({
            target: 'catalog',
            baseUrl: config.getOrThrow<string>('services.catalogUrl'),
          }),
        ),
    },
    {
      provide: IdentityClient,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new IdentityClient(
          new ResilientHttpClient({
            target: 'identity',
            baseUrl: config.getOrThrow<string>('services.identityUrl'),
          }),
        ),
    },
    {
      provide: FptAiClient,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const ai = config.getOrThrow<AiConfig>('ai');
        // Chế độ external (ADR-0013): không lộ X-Internal-Token ra ngoài
        return new FptAiClient(
          new ResilientHttpClient({
            target: 'fpt-ai',
            baseUrl: ai.baseUrl,
            external: true,
            headers: { Authorization: `Bearer ${ai.key}` },
          }),
          {
            model: ai.model,
            callTimeoutMs: ai.callTimeoutMs,
            tools: [SEARCH_PRODUCTS_TOOL],
          },
        );
      },
    },
  ],
  exports: [CatalogClient, IdentityClient, FptAiClient],
})
export class ClientsModule {}
