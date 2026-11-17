import { bootstrapService } from '@nextech/service-kit';
import { AppModule } from './app.module';

// test CI/CD

void bootstrapService(AppModule, {
  name: 'catalog',
  port: Number(process.env.PORT ?? 3002),
});
