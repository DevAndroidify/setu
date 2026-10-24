import { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import spec from '../fixtures/mappings/household-register.v1.json';
import { encodeCp1252, generateRegister } from '../../tools/generate-legacy-data';
import { apiClient } from '../support/api-client';
import { startApi } from '../support/app';
import { createTestPool } from '../support/db';

type PreviewRow = {
  rowNo: number;
  status: string;
  values: Record<string, string | null>;
  errors: { field: string; message: string }[];
};

describe('mappings and preview', () => {
  let app: INestApplication;
  let pool: Pool;
  let api: ReturnType<typeof apiClient>;
  let operator: string;

  beforeAll(async () => {
    app = await startApi();
    pool = createTestPool();
    api = apiClient(app, pool);
    operator = (await api.login('operator')).token;
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  const register = generateRegister({ rows: 200, seed: 42, encoding: 'cp1252' });
  const utf8 = generateRegister({ rows: 200, seed: 42, encoding: 'utf8' });

  it('saves each new spec as the next version', async () => {
    const { sourceId } = await api.uploadFile(operator, Buffer.from(`SN\r\n${Date.now()}\r\n`));
    const v1 = await api.as(operator).post(`/sources/${sourceId}/mappings`, spec).expect(201);
    const v2 = await api.as(operator).post(`/sources/${sourceId}/mappings`, spec).expect(201);
    expect([v1.body.version, v2.body.version]).toEqual([1, 2]);
    const list = await api.as(operator).get(`/sources/${sourceId}/mappings`).expect(200);
    expect(list.body.map((m: { version: number }) => m.version)).toEqual([2, 1]);
  });

  it('rejects an invalid spec with the reason for each problem', async () => {
    const { sourceId } = await api.uploadFile(operator, Buffer.from(`SN\r\n${Date.now()}x\r\n`));
    const res = await api
      .as(operator)
      .post(`/sources/${sourceId}/mappings`, {
        fields: [{ target: 'person.name_ne', from: ['NAAM'], transforms: [{ name: 'magic' }] }],
      })
      .expect(400);
    const messages = res.body.errors.map((e: { message: string }) => e.message);
    expect(messages).toEqual(
      expect.arrayContaining(['unknown transform "magic"', 'person.name_en must be mapped']),
    );
  });

  it('previews the messy register: normalized values for good rows, every error for bad ones', async () => {
    const { sourceId, fileId } = await api.uploadFile(operator, encodeCp1252(register.csv));
    const mapping = await api.as(operator).post(`/sources/${sourceId}/mappings`, spec).expect(201);

    const res = await api
      .as(operator)
      .post(`/mappings/${mapping.body.id}/preview`, { sourceFileId: fileId })
      .expect(200);
    const rows: PreviewRow[] = res.body.rows;
    expect(rows).toHaveLength(50);
    expect(res.body.summary.valid + res.body.summary.quarantined).toBe(50);

    // Normalized: Preeti -> Devanagari, BS -> AD, codes -> enums, English name cased.
    const NAAM = register.header.indexOf('NAAM');
    rows.forEach((row, i) => expect(row.values.name_ne).toBe(utf8.rows[i]![NAAM]));
    const clean = rows.find((r) => r.status === 'valid' && r.values.dob_ad)!;
    expect(clean.values).toMatchObject({
      gender: expect.stringMatching(/^(male|female)$/),
      dob_ad: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      name_en: expect.stringMatching(/^[A-Z][a-z]+ [A-Z][a-z]+$/),
    });

    // Errors: every planted impossible date and bad citizenship number in these 50 rows.
    const planted = register.truth.anomalies.filter(
      (a) => a.row <= 50 && (a.kind === 'impossible_dob' || a.kind === 'bad_citizenship'),
    );
    expect(planted.length).toBeGreaterThan(0);
    for (const { row, kind } of planted) {
      const field = kind === 'impossible_dob' ? 'dob_ad' : 'citizenship_no';
      expect(rows[row - 1]!.status).toBe('quarantined');
      expect(rows[row - 1]!.errors.map((e) => e.field)).toContain(field);
    }

    // Preview writes nothing.
    const { rows: written } = await pool.query(
      'SELECT count(*)::int AS n FROM target.persons WHERE created_by_run IS NOT NULL',
    );
    expect(written[0].n).toBe(0);
  });

  it('refuses to preview a file from a different source', async () => {
    const a = await api.uploadFile(operator, Buffer.from(`SN\r\n${Date.now()}a\r\n`));
    const b = await api.uploadFile(operator, Buffer.from(`SN\r\n${Date.now()}b\r\n`));
    const mapping = await api
      .as(operator)
      .post(`/sources/${a.sourceId}/mappings`, spec)
      .expect(201);
    await api
      .as(operator)
      .post(`/mappings/${mapping.body.id}/preview`, { sourceFileId: b.fileId })
      .expect(422);
  });

  it('names the columns a mapping needs that the file does not have', async () => {
    const { sourceId, fileId } = await api.uploadFile(
      operator,
      Buffer.from(`SN,NAAM\r\n${Date.now()},/fd\r\n`),
    );
    const mapping = await api.as(operator).post(`/sources/${sourceId}/mappings`, spec).expect(201);
    const res = await api
      .as(operator)
      .post(`/mappings/${mapping.body.id}/preview`, { sourceFileId: fileId })
      .expect(422);
    expect(res.body.detail).toContain('NAAM_EN');
  });
});
