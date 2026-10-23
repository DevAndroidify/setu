import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ApiModule } from '../../apps/api/api.module';

// Needs the compose services running (`docker compose up -d`) and a .env file.
// process.loadEnvFile does not reach Jest's sandboxed process.env, so parse the file by hand.
Object.assign(process.env, parseEnv(readFileSync('.env', 'utf8')));

async function startApi(overrides: Record<string, string> = {}): Promise<INestApplication> {
  Object.assign(process.env, overrides);
  const moduleRef = await Test.createTestingModule({ imports: [ApiModule] }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

describe('health endpoints', () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
  });

  it('answers /health/live with 200', async () => {
    const app = await startApi();
    await request(app.getHttpServer()).get('/health/live').expect(200, { status: 'ok' });
    await app.close();
  });

  it('answers /health/ready with 200 when Postgres, Redis and MinIO are reachable', async () => {
    const app = await startApi();
    const res = await request(app.getHttpServer()).get('/health/ready').expect(200);
    expect(res.body).toEqual({
      status: 'ok',
      checks: { postgres: { status: 'up' }, redis: { status: 'up' }, minio: { status: 'up' } },
    });
    await app.close();
  });

  it('answers /health/ready with 503 problem+json when Redis is unreachable', async () => {
    const app = await startApi({ REDIS_URL: 'redis://localhost:1' });
    const res = await request(app.getHttpServer()).get('/health/ready').expect(503);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body.checks.redis.status).toBe('down');
    expect(res.body.checks.postgres.status).toBe('up');
    await app.close();
  });
});
