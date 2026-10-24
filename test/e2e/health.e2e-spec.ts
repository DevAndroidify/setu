import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { startApi } from '../support/app';

describe('health endpoints', () => {
  const original = { ...process.env };
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
    process.env = { ...original };
  });

  it('answers /health/live with 200 and needs no token', async () => {
    app = await startApi();
    await request(app.getHttpServer()).get('/health/live').expect(200, { status: 'ok' });
  });

  it('answers /health/ready with 200 when Postgres, Redis and MinIO are reachable', async () => {
    app = await startApi();
    const res = await request(app.getHttpServer()).get('/health/ready').expect(200);
    expect(res.body).toEqual({
      status: 'ok',
      checks: { postgres: { status: 'up' }, redis: { status: 'up' }, minio: { status: 'up' } },
    });
  });

  it('answers /health/ready with 503 problem+json when Redis is unreachable', async () => {
    app = await startApi({ env: { REDIS_URL: 'redis://localhost:1' } });
    const res = await request(app.getHttpServer()).get('/health/ready').expect(503);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body.checks.redis.status).toBe('down');
    expect(res.body.checks.postgres.status).toBe('up');
  });
});
