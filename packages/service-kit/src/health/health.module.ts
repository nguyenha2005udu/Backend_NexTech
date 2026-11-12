import {
  Controller,
  DynamicModule,
  Get,
  HttpStatus,
  Inject,
  Module,
  Res,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { Response } from 'express';
import type { HealthCheck } from './checks';

const HEALTH_OPTIONS = Symbol('HEALTH_OPTIONS');
const CHECK_TIMEOUT_MS = 1000;

export interface HealthModuleOptions {
  service: string;
  checks: HealthCheck[];
}

function withTimeout(p: Promise<unknown>, ms: number): Promise<unknown> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('health check timeout')), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

// GET /health — không qua prefix /api, không cần xác thực (API_Spec §4)
@Controller('health')
class HealthController {
  constructor(
    @Inject(HEALTH_OPTIONS) private readonly opts: HealthModuleOptions,
    private readonly moduleRef: ModuleRef,
  ) {}

  @Get()
  async health(@Res() res: Response): Promise<void> {
    const results = await Promise.all(
      this.opts.checks.map(async (c) => {
        try {
          await withTimeout(
            Promise.resolve().then(() => c.check(this.moduleRef)),
            CHECK_TIMEOUT_MS,
          );
          return { c, up: true };
        } catch {
          return { c, up: false };
        }
      }),
    );

    const ok = results.every(({ c, up }) => up || c.required === false);
    res.status(ok ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE).json({
      status: ok ? 'ok' : 'down',
      service: this.opts.service,
      uptime_s: Math.floor(process.uptime()),
      checks: Object.fromEntries(
        results.map(({ c, up }) => [c.name, up ? 'up' : 'down']),
      ),
    });
  }
}

@Module({})
export class HealthModule {
  static forRoot(opts: HealthModuleOptions): DynamicModule {
    return {
      module: HealthModule,
      controllers: [HealthController],
      providers: [{ provide: HEALTH_OPTIONS, useValue: opts }],
    };
  }
}
