import { bootstrapService } from '@nextech/service-kit';
import { AppModule } from './app.module';

void bootstrapService(AppModule, {
  name: 'promotion',
  port: Number(process.env.PORT ?? 3003),
});
