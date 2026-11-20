import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ResilientHttpClient } from '@nextech/service-kit';
import { CatalogClient } from './catalog.client';
import { IdentityClient } from './identity.client';
import { PromotionClient } from './promotion.client';

// Client tới service khác (NT.ORDER Component_Class_Design §5), mỗi client một ResilientHttpClient
// (mạch riêng theo đích). URL lấy từ env (architecture §8): *_SERVICE_URL. Khuôn: catalog/src/clients.
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
      provide: PromotionClient,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new PromotionClient(
          new ResilientHttpClient({
            target: 'promotion',
            baseUrl: config.getOrThrow<string>('services.promotionUrl'),
          }),
        ),
    },
  ],
  exports: [CatalogClient, IdentityClient, PromotionClient],
})
export class ClientsModule {}
