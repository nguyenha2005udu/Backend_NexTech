import {
  INestApplication,
  Logger,
  RequestMethod,
  ValidationPipe,
} from '@nestjs/common';
import { IEntryNestModule, NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { requestContextMiddleware } from './context/request-context';
import { AllExceptionsFilter } from './errors/all-exceptions.filter';

export interface BootstrapOptions {
  name: string;
  port: number;
}

// Dựng app NestJS cho mọi service (Component_Class_Design §5).
// Không bật CORS: gateway lo, bật cả hai sẽ trùng header.
export async function bootstrapService(
  module: IEntryNestModule,
  opts: BootstrapOptions,
): Promise<INestApplication> {
  const app = await NestFactory.create(module);
  app.use(cookieParser());
  app.use(requestContextMiddleware);
  // Giữ đúng cấu hình của be/src/main.ts
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  // /health và /internal/* không qua prefix /api
  app.setGlobalPrefix('api', {
    exclude: [
      { path: 'health', method: RequestMethod.ALL },
      { path: 'internal/{*path}', method: RequestMethod.ALL },
    ],
  });
  app.enableShutdownHooks();
  await app.listen(opts.port, '0.0.0.0');
  new Logger(opts.name).log(`Service ${opts.name} chạy ở cổng ${opts.port}`);
  return app;
}
