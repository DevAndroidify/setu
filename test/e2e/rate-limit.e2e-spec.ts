import { INestApplication } from '@nestjs/common';
import Redis from 'ioredis';
import request from 'supertest';
import { startApi } from '../support/app';

// Other tests signed in from this address in the same minute: start from zero.
async function clearCounters(): Promise<void> {
  const redis = new Redis(process.env.REDIS_URL!);
  const keys = await redis.keys('ratelimit:auth:*');
  if (keys.length) await redis.del(...keys);
  redis.disconnect();
}

const attempt = (app: INestApplication, forwardedFor?: string) => {
  const req = request(app.getHttpServer()).post('/api/v1/auth/login');
  if (forwardedFor) req.set('X-Forwarded-For', forwardedFor);
  return req.send({ email: 'nobody@setu.local', password: 'wrong-password' });
};

describe('rate limit on /auth', () => {
  const saved = { ...process.env };
  let app: INestApplication;

  beforeAll(async () => {
    await clearCounters();
    app = await startApi({ env: { AUTH_RATE_LIMIT_PER_MINUTE: '3' } });
  });

  afterAll(async () => {
    await app.close();
    process.env.AUTH_RATE_LIMIT_PER_MINUTE = saved.AUTH_RATE_LIMIT_PER_MINUTE;
  });

  it('answers 429 with Retry-After once an address exceeds the limit in a minute', async () => {
    for (let i = 0; i < 3; i++) expect((await attempt(app)).status).toBe(401);
    const limited = await attempt(app).expect(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(limited.body).toMatchObject({ status: 429, title: 'Too Many Requests' });
  });

  it('ignores X-Forwarded-For unless told to trust a proxy, so clients cannot dodge the limit', async () => {
    await attempt(app, '203.0.113.99').expect(429);
  });

  it('does not limit the rest of the API', async () => {
    await request(app.getHttpServer()).get('/health/live').expect(200);
  });
});

describe('rate limit on /auth behind a reverse proxy', () => {
  const saved = { ...process.env };
  let app: INestApplication;

  beforeAll(async () => {
    await clearCounters();
    app = await startApi({ env: { AUTH_RATE_LIMIT_PER_MINUTE: '3', TRUST_PROXY_HOPS: '1' } });
  });

  afterAll(async () => {
    await app.close();
    process.env.AUTH_RATE_LIMIT_PER_MINUTE = saved.AUTH_RATE_LIMIT_PER_MINUTE;
    process.env.TRUST_PROXY_HOPS = saved.TRUST_PROXY_HOPS;
    if (saved.TRUST_PROXY_HOPS === undefined) delete process.env.TRUST_PROXY_HOPS;
  });

  it('counts each client address the proxy reports, not the proxy itself', async () => {
    for (let i = 0; i < 3; i++) expect((await attempt(app, '203.0.113.10')).status).toBe(401);
    await attempt(app, '203.0.113.10').expect(429);
    await attempt(app, '203.0.113.20').expect(401);
  });

  it('trusts only the hop the proxy added, so a forged address in front does not help', async () => {
    // The proxy appends the real client (203.0.113.10) after whatever the client sent.
    await attempt(app, '198.51.100.1, 203.0.113.10').expect(429);
  });
});
