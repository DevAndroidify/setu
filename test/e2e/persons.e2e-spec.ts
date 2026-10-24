import { INestApplication, INestApplicationContext } from '@nestjs/common';
import { Pool } from 'pg';
import { encodeCp1252, generateRegister } from '../../tools/generate-legacy-data';
import { apiClient } from '../support/api-client';
import { startApi } from '../support/app';
import { createTestPool } from '../support/db';
import { createRun, startRun, startWorker, waitForRun } from '../support/pipeline';

const MASKED = /^\*\*-\*\*-\*\*-\d{5}$/;

describe('persons API', () => {
  let app: INestApplication;
  let worker: INestApplicationContext;
  let pool: Pool;
  let api: ReturnType<typeof apiClient>;
  let tokens: Record<'operator' | 'reviewer' | 'auditor' | 'admin' | 'approver', string>;
  let runId: string;
  let withNumber: { id: string; name_en: string };

  beforeAll(async () => {
    app = await startApi();
    worker = await startWorker();
    pool = createTestPool();
    api = apiClient(app, pool);
    const login = async (role: string) => (await api.login(role)).token;
    tokens = {
      operator: await login('operator'),
      reviewer: await login('reviewer'),
      auditor: await login('auditor'),
      admin: await login('admin'),
      approver: await login('approver'),
    };
    const register = generateRegister({ rows: 400, seed: 1717, encoding: 'cp1252' });
    ({ runId } = await createRun(api, tokens.operator, encodeCp1252(register.csv), 'production'));
    await startRun(api, tokens.operator, runId);
    expect((await waitForRun(pool, runId)).status).toBe('completed');
    const { rows } = await pool.query(
      `SELECT id, name_en FROM target.persons WHERE created_by_run = $1 AND citizenship_no IS NOT NULL LIMIT 1`,
      [runId],
    );
    withNumber = rows[0];
  }, 120_000);

  afterAll(async () => {
    await worker.close();
    await app.close();
    await pool.end();
  });

  it('masks every citizenship number in search results, for every role', async () => {
    for (const token of Object.values(tokens)) {
      const res = await api.as(token).get('/persons?limit=100').expect(200);
      const numbers = res.body.data.map((p: { citizenship_no: string | null }) => p.citizenship_no);
      expect(numbers.filter(Boolean).length).toBeGreaterThan(0);
      for (const n of numbers.filter(Boolean)) expect(n).toMatch(MASKED);
    }
  });

  it('finds persons by part of their English name, case-insensitively, page by page', async () => {
    const term = withNumber.name_en.split(' ')[1]!.toLowerCase();
    const first = await api.as(tokens.operator).get(`/persons?q=${term}&limit=2`).expect(200);
    expect(first.body.data).toHaveLength(2);
    for (const p of first.body.data) expect(p.name_en.toLowerCase()).toContain(term);
    const next = await api
      .as(tokens.operator)
      .get(`/persons?q=${term}&limit=2&cursor=${first.body.nextCursor}`)
      .expect(200);
    expect(next.body.data[0].id > first.body.data[1].id).toBe(true);
  });

  it('shows the household, its local unit and ward, and the BS date of birth on request', async () => {
    const res = await api
      .as(tokens.operator)
      .get(`/persons/${withNumber.id}?calendar=bs`)
      .expect(200);
    expect(res.body).toMatchObject({
      id: withNumber.id,
      dob_ad: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      dob_bs: expect.stringMatching(/^20\d{2}-\d{2}-\d{2}$/),
      household: { local_unit_code: expect.any(String), ward_no: expect.any(Number) },
    });
  });

  it('unmasks a citizenship number for an auditor who gives a reason, and audits it', async () => {
    const res = await api
      .as(tokens.auditor)
      .get(`/persons/${withNumber.id}?unmask=true&reason=Complaint%20ref%2042`)
      .expect(200);
    expect(res.body.citizenship_no).toMatch(/^\d{2}-\d{2}-\d{2}-\d{5}$/);
    expect(res.body.citizenship_no_masked).toBe(false);
    const { rows } = await pool.query(
      `SELECT reason FROM audit.events WHERE action = 'person.unmasked' AND entity_id = $1`,
      [withNumber.id],
    );
    expect(rows).toEqual([{ reason: 'Complaint ref 42' }]);
  });

  it('requires a reason to unmask', async () => {
    const res = await api
      .as(tokens.reviewer)
      .get(`/persons/${withNumber.id}?unmask=true`)
      .expect(400);
    expect(res.body.errors[0].path).toBe('reason');
  });

  it('refuses to unmask for operators, approvers and admins', async () => {
    for (const role of ['operator', 'approver', 'admin'] as const) {
      await api
        .as(tokens[role])
        .get(`/persons/${withNumber.id}?unmask=true&reason=Just%20curious`)
        .expect(403);
    }
  });

  it('shows auditors the source rows behind a person, and no one else', async () => {
    const res = await api.as(tokens.auditor).get(`/persons/${withNumber.id}/lineage`).expect(200);
    expect(res.body[0]).toMatchObject({ runId, rawRowId: expect.any(String) });
    await api.as(tokens.operator).get(`/persons/${withNumber.id}/lineage`).expect(403);
  });
});
