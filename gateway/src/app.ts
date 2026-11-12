import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import type { GatewayConfig } from './config';
import type { Route } from './routes';
import type { GatewayUser } from './auth/token';
import { healthRouter } from './health';
import { createAuthenticate } from './middleware/authenticate';
import { requestId } from './middleware/request-id';
import { createProxy } from './middleware/proxy';
import { createRateLimits } from './middleware/rate-limit';
import { resolveRoute } from './middleware/resolve-route';
import { stripClientHeaders } from './middleware/strip-headers';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      gatewayRoute: Route;
      user?: GatewayUser;
      proxyStartedAt?: number;
    }
  }
}

// Lắp middleware đúng thứ tự NT.GATEWAY Component_Class_Design §2.
// KHÔNG dùng express.json(): parse body làm treo proxy và hỏng upload.
export function createApp(config: GatewayConfig): Express {
  const app = express();
  const limits = createRateLimits(config);
  app.disable('x-powered-by');
  app.use(requestId);
  app.use(cors({ origin: config.corsOrigins, credentials: true }));
  app.use(cookieParser()); // chỉ đọc cookie, không đụng body
  app.use(healthRouter(config));
  app.use(limits.general);
  app.use(stripClientHeaders);
  app.use(resolveRoute); // không có route: 404
  app.use(limits.auth); // chỉ route đăng nhập
  app.use(limits.ai); // chỉ route ai
  app.use(createAuthenticate(config)); // theo route.access
  app.use(createProxy(config));
  return app;
}
