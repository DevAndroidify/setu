import { Controller, Get, INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import request from 'supertest';
import { Roles } from '../../src/modules/auth/decorators';
import { startApi } from '../support/app';
import { createTestPool, insertLoginUser } from '../support/db';

const PASSWORD = 'correct-horse-battery';

/** A route only approvers may call, to exercise the role guard. */
@Controller('test/approver-only')
class ApproverOnlyController {
  @Roles('approver')
  @Get()
  ok() {
    return { ok: true };
  }
}

const refreshCookie = (res: request.Response): string => {
  const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  const cookie = cookies.find((c) => c.startsWith('setu_refresh='));
  if (!cookie) throw new Error('no refresh cookie set');
  return cookie.split(';')[0]!;
};

describe('auth', () => {
  let app: INestApplication;
  let pool: Pool;

  beforeAll(async () => {
    app = await startApi({ controllers: [ApproverOnlyController] });
    pool = createTestPool();
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  const http = () => request(app.getHttpServer());
  const login = (email: string, password = PASSWORD) =>
    http().post('/api/v1/auth/login').send({ email, password });

  describe('POST /auth/login', () => {
    it('returns an access token and sets an httpOnly refresh cookie', async () => {
      const user = await insertLoginUser(pool, 'operator', PASSWORD);
      const res = await login(user.email.toUpperCase()).expect(200);

      expect(res.body).toEqual({
        accessToken: expect.any(String),
        tokenType: 'Bearer',
        expiresIn: 900,
      });
      const cookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []).join();
      expect(cookie).toMatch(/setu_refresh=[\w-]+;.*HttpOnly/);
      expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
      expect(cookie).toMatch(/SameSite=Strict/);
    });

    it('rejects a wrong password with 401 problem+json', async () => {
      const user = await insertLoginUser(pool, 'operator', PASSWORD);
      const res = await login(user.email, 'wrong-password').expect(401);
      expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
      expect(res.headers['x-request-id']).toBeDefined();
      expect(res.body).toEqual({
        type: 'about:blank',
        title: 'Unauthorized',
        status: 401,
        detail: 'Invalid email or password',
      });
    });

    it('answers an unknown email exactly like a wrong password', async () => {
      const res = await login('nobody@setu.test').expect(401);
      expect(res.body.detail).toBe('Invalid email or password');
    });

    it('rejects a malformed body with 400 and the invalid fields', async () => {
      const res = await http()
        .post('/api/v1/auth/login')
        .send({ email: 'not-an-email' })
        .expect(400);
      expect(res.body.errors.map((e: { path: string }) => e.path).sort()).toEqual([
        'email',
        'password',
      ]);
    });

    it('locks the account after 5 failed logins, even for the right password', async () => {
      const user = await insertLoginUser(pool, 'operator', PASSWORD);
      for (let i = 0; i < 5; i++) await login(user.email, 'wrong-password').expect(401);

      await login(user.email).expect(401);
      const { rows } = await pool.query('SELECT locked_until FROM control.users WHERE id = $1', [
        user.id,
      ]);
      expect(rows[0].locked_until.getTime()).toBeGreaterThan(Date.now());
    });

    it('resets the failure count after a successful login', async () => {
      const user = await insertLoginUser(pool, 'operator', PASSWORD);
      for (let i = 0; i < 4; i++) await login(user.email, 'wrong-password').expect(401);
      await login(user.email).expect(200);
      for (let i = 0; i < 4; i++) await login(user.email, 'wrong-password').expect(401);
      await login(user.email).expect(200);
    });
  });

  describe('GET /me', () => {
    it('returns 401 without an access token', async () => {
      const res = await http().get('/api/v1/me').expect(401);
      expect(res.body.detail).toBe('Missing access token');
    });

    it('returns 401 for a forged token', async () => {
      await http().get('/api/v1/me').set('Authorization', 'Bearer not.a.jwt').expect(401);
    });

    it('returns the current user for a valid token', async () => {
      const user = await insertLoginUser(pool, 'auditor', PASSWORD);
      const { body } = await login(user.email).expect(200);
      const res = await http()
        .get('/api/v1/me')
        .set('Authorization', `Bearer ${body.accessToken}`)
        .expect(200);
      expect(res.body).toEqual({ id: user.id, email: user.email, role: 'auditor' });
    });
  });

  describe('role guard', () => {
    it('returns 403 when an operator calls an approver-only route', async () => {
      const user = await insertLoginUser(pool, 'operator', PASSWORD);
      const { body } = await login(user.email).expect(200);
      const res = await http()
        .get('/api/v1/test/approver-only')
        .set('Authorization', `Bearer ${body.accessToken}`)
        .expect(403);
      expect(res.body.title).toBe('Forbidden');
    });

    it('lets an approver call an approver-only route', async () => {
      const user = await insertLoginUser(pool, 'approver', PASSWORD);
      const { body } = await login(user.email).expect(200);
      await http()
        .get('/api/v1/test/approver-only')
        .set('Authorization', `Bearer ${body.accessToken}`)
        .expect(200, { ok: true });
    });
  });

  describe('POST /auth/refresh', () => {
    it('returns 401 without a refresh cookie', async () => {
      await http().post('/api/v1/auth/refresh').expect(401);
    });

    it('issues new tokens and a new refresh cookie', async () => {
      const user = await insertLoginUser(pool, 'operator', PASSWORD);
      const first = refreshCookie(await login(user.email).expect(200));

      const res = await http().post('/api/v1/auth/refresh').set('Cookie', first).expect(200);
      expect(res.body.accessToken).toEqual(expect.any(String));
      expect(refreshCookie(res)).not.toBe(first);
    });

    it('treats reuse of a rotated refresh token as theft and revokes every session', async () => {
      const user = await insertLoginUser(pool, 'operator', PASSWORD);
      const first = refreshCookie(await login(user.email).expect(200));
      const second = refreshCookie(
        await http().post('/api/v1/auth/refresh').set('Cookie', first).expect(200),
      );

      await http().post('/api/v1/auth/refresh').set('Cookie', first).expect(401);
      // The legitimate holder's newer token is revoked too.
      await http().post('/api/v1/auth/refresh').set('Cookie', second).expect(401);
    });
  });
});
