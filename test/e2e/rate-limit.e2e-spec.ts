import { INestApplication } from '@nestjs/common';
import Redis from 'ioredis';
import request from 'supertest';
import { startApi } from '../support/app';

describe('rate limit on /auth', () => {
  const saved = process.env.AUTH_RATE_LIMIT_PER_MINUTE;
  let app: INestApplication;

  beforeAll(async () => {
    const redis = new Redis(process.env.REDIS_URL!);
    // Other tests signed in from this address in the same minute: start from zero.
    const keys = await redis.keys('ratelimit:auth:*');
    if (keys.length) await redis.del(...keys);
    redis.disconnect();
    app = await startApi({ env: { AUTH_RATE_LIMIT_PER_MINUTE: '3' } });
  });

  afterAll(async () => {
    await app.close();
    process.env.AUTH_RATE_LIMIT_PER_MINUTE = saved;
  });

  it('answers 429 with Retry-After once an address exceeds the limit in a minute', async () => {
    const attempt = () =>
      request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'nobody@setu.local', password: 'wrong-password' });
    for (let i = 0; i < 3; i++) expect((await attempt()).status).toBe(401);
    const limited = await attempt().expect(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(limited.body).toMatchObject({ status: 429, title: 'Too Many Requests' });
  });

  it('does not limit the rest of the API', async () => {
    await request(app.getHttpServer()).get('/health/live').expect(200);
  });
});
