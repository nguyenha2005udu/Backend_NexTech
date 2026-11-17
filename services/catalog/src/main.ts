import { bootstrapService } from '@nextech/service-kit';
import { AppModule } from './app.module';

void bootstrapService(AppModule, {
  name: 'catalog',
  port: Number(process.env.PORT ?? 3002),
});
