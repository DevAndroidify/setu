import { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import request from 'supertest';
import { insertLoginUser } from './db';

export const TEST_PASSWORD = 'correct-horse-battery';

/** Small helpers for API tests: log in as a role and call routes with that token. */
export function apiClient(app: INestApplication, pool: Pool) {
  const http = () => request(app.getHttpServer());

  async function login(role: string): Promise<{ token: string; userId: string }> {
    const user = await insertLoginUser(pool, role, TEST_PASSWORD);
    const res = await http()
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: TEST_PASSWORD })
      .expect(200);
    return { token: res.body.accessToken, userId: user.id };
  }

  const as = (token: string) => ({
    get: (path: string) => http().get(`/api/v1${path}`).set('Authorization', `Bearer ${token}`),
    post: (path: string, body?: object) =>
      http()
        .post(`/api/v1${path}`)
        .set('Authorization', `Bearer ${token}`)
        .send(body ?? {}),
    upload: (path: string, bytes: Buffer, filename = 'register.csv') =>
      http()
        .post(`/api/v1${path}`)
        .set('Authorization', `Bearer ${token}`)
        .attach('file', bytes, filename),
  });

  /** Registers a source of the given kind and uploads the bytes; returns both ids. */
  async function uploadFile(token: string, bytes: Buffer, kind = 'csv', filename?: string) {
    const source = await as(token)
      .post('/sources', {
        name: 'Household register',
        kind,
        agency: 'Ward office (synthetic)',
      })
      .expect(201);
    const file = await as(token)
      .upload(`/sources/${source.body.id}/files`, bytes, filename)
      .expect(202);
    return { sourceId: source.body.id as string, fileId: file.body.id as string };
  }

  return { http, login, as, uploadFile };
}
