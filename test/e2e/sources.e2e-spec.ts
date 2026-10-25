import { INestApplicationContext, INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';
import request from 'supertest';
import { WorkerModule } from '../../apps/worker/worker.module';
import { encodeCp1252, generateRegister } from '../../tools/generate-legacy-data';
import { startApi } from '../support/app';
import { createTestPool, insertLoginUser } from '../support/db';

const PASSWORD = 'correct-horse-battery';

type Column = {
  name: string;
  preeti: { likely: boolean };
  dateFormats: { format: string; count: number }[];
};

describe('sources and profiling', () => {
  let app: INestApplication;
  let worker: INestApplicationContext;
  let pool: Pool;
  let operator: string;

  beforeAll(async () => {
    app = await startApi();
    worker = await NestFactory.createApplicationContext(WorkerModule, { logger: false });
    pool = createTestPool();
    operator = await tokenFor('operator');
  });

  afterAll(async () => {
    await worker.close();
    await app.close();
    await pool.end();
  });

  const http = () => request(app.getHttpServer());

  async function tokenFor(role: string): Promise<string> {
    const user = await insertLoginUser(pool, role, PASSWORD);
    const res = await http()
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: PASSWORD })
      .expect(200);
    return res.body.accessToken;
  }

  async function createSource(token = operator, kind = 'csv'): Promise<string> {
    const res = await http()
      .post('/api/v1/sources')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Household register', kind, agency: 'Ward office (synthetic)' })
      .expect(201);
    return res.body.id;
  }

  const upload = (sourceId: string, bytes: Buffer, filename = 'register.csv') =>
    http()
      .post(`/api/v1/sources/${sourceId}/files`)
      .set('Authorization', `Bearer ${operator}`)
      .attach('file', bytes, filename);

  /** Polls until the worker has saved the profile. */
  async function waitForProfile(fileId: string) {
    const deadline = Date.now() + 20_000;
    for (;;) {
      const res = await http()
        .get(`/api/v1/files/${fileId}/profile`)
        .set('Authorization', `Bearer ${operator}`);
      if (res.status === 200) return res.body;
      if (res.status !== 404 || Date.now() > deadline) {
        throw new Error(`profile not ready: ${res.status} ${JSON.stringify(res.body)}`);
      }
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  it('profiles the generated Windows-1252 register: Preeti columns and date formats flagged', async () => {
    const sourceId = await createSource();
    const register = generateRegister({ rows: 1000, seed: 42, encoding: 'cp1252' });

    const res = await upload(sourceId, encodeCp1252(register.csv)).expect(202);
    expect(res.body).toMatchObject({ sourceId, encoding: 'windows-1252', rowCount: null });

    const profile = await waitForProfile(res.body.id);
    const column = (name: string) => profile.columns.find((c: Column) => c.name === name) as Column;
    expect(profile).toMatchObject({ status: 'ok', encoding: 'windows-1252', rowCount: 1000 });
    expect(column('NAAM').preeti.likely).toBe(true);
    expect(column('BABU_NAAM').preeti.likely).toBe(true);
    expect(column('NAAM_EN').preeti.likely).toBe(false);
    expect(
      column('JANMA_MITI')
        .dateFormats.map((f) => f.format)
        .sort(),
    ).toEqual(['D/M/YYYY', 'YYYY-MM-DD', 'YYYY.MM.DD', 'YYYY/M/D']);

    const { rows } = await pool.query('SELECT row_count FROM control.source_files WHERE id = $1', [
      res.body.id,
    ]);
    expect(rows[0].row_count).toBe(1000);
  });

  it('refuses the same file a second time, even under another name', async () => {
    const sourceId = await createSource();
    const bytes = Buffer.from('SN,NAAM\r\n1,/fd yfkf\r\n', 'utf8');
    const first = await upload(sourceId, bytes, 'a.csv').expect(202);
    const second = await upload(sourceId, bytes, 'renamed.csv').expect(409);
    expect(second.body.detail).toContain(first.body.id);
  });

  it('records the upload in the audit trail', async () => {
    const sourceId = await createSource();
    const res = await upload(sourceId, Buffer.from(`SN\r\n${Date.now()}\r\n`)).expect(202);
    const { rows } = await pool.query(
      `SELECT action FROM audit.events WHERE entity_id = $1 ORDER BY occurred_at`,
      [res.body.id],
    );
    expect(rows[0].action).toBe('source_file.uploaded');
  });

  it('saves a failed profile for a malformed CSV instead of retrying', async () => {
    const sourceId = await createSource();
    const res = await upload(sourceId, Buffer.from('A,B\r\n"unclosed,1\r\n')).expect(202);
    const profile = await waitForProfile(res.body.id);
    expect(profile.status).toBe('failed');
    expect(profile.error).toMatch(/quote/i);
  });

  it('rejects a binary file regardless of its .csv name', async () => {
    const sourceId = await createSource();
    const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]);
    const res = await upload(sourceId, zip, 'looks-like.csv').expect(415);
    expect(res.headers['content-type']).toMatch(/problem\+json/);
  });

  it('forbids a reviewer from registering sources', async () => {
    const reviewer = await tokenFor('reviewer');
    await http()
      .post('/api/v1/sources')
      .set('Authorization', `Bearer ${reviewer}`)
      .send({ name: 'x', kind: 'csv', agency: 'y' })
      .expect(403);
  });

  it('returns 404 for the profile of an unknown file', async () => {
    await http()
      .get('/api/v1/files/00000000-0000-4000-8000-000000000000/profile')
      .set('Authorization', `Bearer ${operator}`)
      .expect(404);
  });
});
