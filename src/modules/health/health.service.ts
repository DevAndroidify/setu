import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { ENV } from '../../shared/config/config.module';
import type { Env } from '../../shared/config/env.schema';
import { PG_POOL } from '../../shared/db/db.module';
import { REDIS } from '../../shared/queue/redis.module';

export type DependencyName = 'postgres' | 'redis' | 'minio';
export type CheckResult = { status: 'up' | 'down'; error?: string };
export type ReadinessReport = {
  status: 'ok' | 'unavailable';
  checks: Record<DependencyName, CheckResult>;
};

const CHECK_TIMEOUT_MS = 2000;

export function summarize(checks: Record<DependencyName, CheckResult>): ReadinessReport {
  const allUp = Object.values(checks).every((c) => c.status === 'up');
  return { status: allUp ? 'ok' : 'unavailable', checks };
}

@Injectable()
export class HealthService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async checkReady(): Promise<ReadinessReport> {
    const [postgres, redis, minio] = await Promise.all([
      this.run(() => this.pool.query('SELECT 1')),
      this.run(() => this.redis.ping()),
      this.run(async () => {
        const res = await fetch(new URL('/minio/health/ready', this.env.S3_ENDPOINT), {
          signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(`MinIO answered ${res.status}`);
      }),
    ]);
    return summarize({ postgres, redis, minio });
  }

  private async run(probe: () => Promise<unknown>): Promise<CheckResult> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timed out')), CHECK_TIMEOUT_MS);
    });
    try {
      await Promise.race([probe(), timeout]);
      return { status: 'up' };
    } catch (err) {
      return { status: 'down', error: err instanceof Error ? err.message : 'unknown error' };
    } finally {
      clearTimeout(timer);
    }
  }
}
