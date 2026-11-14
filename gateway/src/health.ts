import { Router } from 'express';
import { SERVICE_NAMES, type GatewayConfig, type ServiceName } from './config';

const CHECK_TIMEOUT_MS = 1000;

async function check(baseUrl: string): Promise<'up' | 'down'> {
  try {
    const res = await fetch(new URL('/health', baseUrl), {
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    return res.ok ? 'up' : 'down';
  } catch {
    return 'down';
  }
}

// GET /health: gateway còn sống, không kiểm tra service khác.
// GET /health/services: gọi /health của từng service, timeout 1 giây, phục vụ demo (API_Spec §1).
export function healthRouter(config: GatewayConfig): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'gateway',
      uptime_s: Math.floor(process.uptime()),
    });
  });

  router.get('/health/services', async (_req, res) => {
    const results = await Promise.all(
      SERVICE_NAMES.map(
        async (s) => [s, await check(config.serviceUrls[s])] as const,
      ),
    );
    res.json({
      services: Object.fromEntries(results) as Record<
        ServiceName,
        'up' | 'down'
      >,
    });
  });

  return router;
}
