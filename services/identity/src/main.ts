import { bootstrapService } from '@nextech/service-kit';
import { AppModule } from './app.module';

void bootstrapService(AppModule, {
  name: 'identity',
  port: Number(process.env.PORT ?? 3001),
});
