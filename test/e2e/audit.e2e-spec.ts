import { INestApplication } from '@nestjs/common';
import { Client, Pool } from 'pg';
import request from 'supertest';
import { AuditService } from '../../src/modules/audit/audit.service';
import { tamperWithEvent } from '../../tools/tamper-demo';
import { startApi } from '../support/app';
import { createTestPool, insertLoginUser, uniqueStream } from '../support/db';

const PASSWORD = 'correct-horse-battery';

describe('audit API', () => {
  let app: INestApplication;
  let pool: Pool;

  beforeAll(async () => {
    app = await startApi();
    pool = createTestPool();
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  const http = () => request(app.getHttpServer());

  async function tokenFor(role: string): Promise<{ token: string; userId: string }> {
    const user = await insertLoginUser(pool, role, PASSWORD);
    const res = await http()
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: PASSWORD })
      .expect(200);
    return { token: res.body.accessToken, userId: user.id };
  }

  it('records a login in the global audit stream', async () => {
    const auditor = await tokenFor('auditor');
    const res = await http()
      .get('/api/v1/audit/events')
      .query({ entity: 'user', entityId: auditor.userId, action: 'auth.login' })
      .set('Authorization', `Bearer ${auditor.token}`)
      .expect(200);
    expect(res.body.data).toEqual([
      expect.objectContaining({ stream: 'global', action: 'auth.login', actorId: auditor.userId }),
    ]);
  });

  it('records a failed login without revealing the password', async () => {
    const auditor = await tokenFor('auditor');
    const victim = await insertLoginUser(pool, 'operator', PASSWORD);
    await http()
      .post('/api/v1/auth/login')
      .send({ email: victim.email, password: 'guess-1' })
      .expect(401);
    const res = await http()
      .get('/api/v1/audit/events')
      .query({ entityId: victim.id, action: 'auth.login_failed' })
      .set('Authorization', `Bearer ${auditor.token}`)
      .expect(200);
    expect(res.body.data[0].payload).toEqual({ cause: 'wrong_password', locked: false });
    expect(JSON.stringify(res.body)).not.toContain('guess-1');
  });

  it('forbids operators from reading the audit trail', async () => {
    const operator = await tokenFor('operator');
    await http()
      .get('/api/v1/audit/verify')
      .set('Authorization', `Bearer ${operator.token}`)
      .expect(403);
    await http()
      .get('/api/v1/audit/events')
      .set('Authorization', `Bearer ${operator.token}`)
      .expect(403);
  });

  it('pages through events with a cursor', async () => {
    const auditor = await tokenFor('auditor');
    const stream = uniqueStream();
    const audit = app.get(AuditService);
    for (let n = 1; n <= 3; n++)
      await audit.append({ stream, action: 'test.event', entity: 'test' });

    const page = (cursor?: string) =>
      http()
        .get('/api/v1/audit/events')
        .query({ stream, limit: 2, ...(cursor ? { cursor } : {}) })
        .set('Authorization', `Bearer ${auditor.token}`)
        .expect(200);
    const first = await page();
    const second = await page(first.body.nextCursor);
    const seqs = [...first.body.data, ...second.body.data].map((e: { seq: number }) => e.seq);
    expect(seqs.sort()).toEqual([1, 2, 3]);
    expect(second.body.nextCursor).toBeNull();
  });

  it('verifies an intact chain and then reports the exact seq after tampering', async () => {
    const auditor = await tokenFor('auditor');
    const stream = uniqueStream();
    const audit = app.get(AuditService);
    for (let n = 1; n <= 4; n++) {
      await audit.append({ stream, action: 'test.event', entity: 'test', payload: { n } });
    }
    const verify = () =>
      http()
        .get('/api/v1/audit/verify')
        .query({ stream })
        .set('Authorization', `Bearer ${auditor.token}`)
        .expect(200);

    expect((await verify()).body).toMatchObject({ valid: true, eventsChecked: 4 });

    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await tamperWithEvent(client, stream, 2).finally(() => client.end());

    expect((await verify()).body).toEqual({
      valid: false,
      streamsChecked: 1,
      eventsChecked: 1,
      firstBroken: {
        stream,
        seq: 2,
        reason: 'content does not match its hash (the event was modified)',
      },
    });
  });
});
