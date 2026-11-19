import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ResilientHttpClient } from '@nextech/service-kit';
import { IdentityClient } from './identity.client';
import { OrderClient } from './order.client';

// Client tới service khác, mỗi client một ResilientHttpClient (mạch riêng theo đích).
// URL lấy từ env (architecture §8): ORDER_SERVICE_URL, IDENTITY_SERVICE_URL.
@Module({
  providers: [
    {
      provide: OrderClient,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new OrderClient(
          new ResilientHttpClient({
            target: 'order',
            baseUrl: config.getOrThrow<string>('services.orderUrl'),
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
  ],
  exports: [OrderClient, IdentityClient],
})
export class ClientsModule {}
