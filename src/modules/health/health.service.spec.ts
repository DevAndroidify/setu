import { summarize } from './health.service';

const up = { status: 'up' } as const;
const down = { status: 'down', error: 'connection refused' } as const;

describe('summarize', () => {
  it('reports ok when every dependency is up', () => {
    expect(summarize({ postgres: up, redis: up, minio: up }).status).toBe('ok');
  });

  it('reports unavailable when one dependency is down', () => {
    const report = summarize({ postgres: up, redis: down, minio: up });
    expect(report.status).toBe('unavailable');
    expect(report.checks.redis.error).toBe('connection refused');
  });
});
