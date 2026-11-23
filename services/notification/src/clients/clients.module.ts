import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ResilientHttpClient } from '@nextech/service-kit';
import { IdentityClient } from './identity.client';

// Client tới service khác, mỗi client một ResilientHttpClient (mạch riêng theo đích). Khuôn: order/src/clients.
@Module({
  providers: [
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
  exports: [IdentityClient],
})
export class ClientsModule {}
