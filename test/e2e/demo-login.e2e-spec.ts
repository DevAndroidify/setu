import { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import request from 'supertest';
import { hashPassword } from '../../src/modules/auth/password';
import { startApi } from '../support/app';
import { createTestPool } from '../support/db';

/** The seeded demo account of a role (see prisma/seed.ts); synthetic, created once. */
async function ensureDemoUser(pool: Pool, role: string): Promise<string> {
  const email = `${role}@setu.local`;
  await pool.query(
    `INSERT INTO control.users (email, password_hash, role) VALUES ($1, $2, $3)
     ON CONFLICT (email) DO NOTHING`,
    [email, await hashPassword('not-used-by-demo-sign-in'), role],
  );
  return email;
}

describe('demo sign-in', () => {
  let pool: Pool;
  const before = process.env.DEMO_MODE;

  beforeAll(() => {
    pool = createTestPool();
  });

  afterAll(async () => {
    // process.env turns undefined into the string "undefined", so remove the key instead.
    if (before === undefined) delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE = before;
    await pool.end();
  });

  describe('with DEMO_MODE=true', () => {
    let app: INestApplication;
    beforeAll(async () => {
      app = await startApi({ env: { DEMO_MODE: 'true' } });
    });
    afterAll(() => app.close());
    const http = () => request(app.getHttpServer());

    it('signs a visitor in as the demo account of a role, without a password', async () => {
      const email = await ensureDemoUser(pool, 'operator');
      const res = await http().post('/api/v1/auth/demo').send({ role: 'operator' }).expect(200);
      expect(res.body).toEqual({
        accessToken: expect.any(String),
        tokenType: 'Bearer',
        expiresIn: 900,
      });
      const cookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []).join();
      expect(cookie).toMatch(/setu_refresh=[\w-]+;.*HttpOnly/);

      const me = await http()
        .get('/api/v1/me')
        .set('Authorization', `Bearer ${res.body.accessToken}`)
        .expect(200);
      expect(me.body).toMatchObject({ email, role: 'operator' });
    });

    it('records every demo sign-in in the audit trail', async () => {
      await ensureDemoUser(pool, 'reviewer');
      const demoLogins = async () => {
        const { rows } = await pool.query<{ count: string }>(
          `SELECT count(*) FROM audit.events WHERE action = 'auth.demo_login'`,
        );
        return Number(rows[0]!.count);
      };
      const before = await demoLogins();
      await http().post('/api/v1/auth/demo').send({ role: 'reviewer' }).expect(200);
      expect(await demoLogins()).toBe(before + 1);
    });

    it('rejects a role that does not exist with 400 problem+json', async () => {
      const res = await http().post('/api/v1/auth/demo').send({ role: 'superuser' }).expect(400);
      expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    });

    it('says the database is not seeded when the role has no demo account', async () => {
      // No test creates admin@setu.local, so the admin demo account is missing here.
      const res = await http().post('/api/v1/auth/demo').send({ role: 'admin' }).expect(404);
      expect(res.body.detail).toMatch(/db:seed/);
    });
  });

  describe('without DEMO_MODE', () => {
    let app: INestApplication;
    beforeAll(async () => {
      app = await startApi({ env: { DEMO_MODE: 'false' } });
    });
    afterAll(() => app.close());

    it('does not offer demo sign-in at all', async () => {
      await ensureDemoUser(pool, 'operator');
      await request(app.getHttpServer())
        .post('/api/v1/auth/demo')
        .send({ role: 'operator' })
        .expect(404);
    });
  });
});
