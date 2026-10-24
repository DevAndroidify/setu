import { INestApplication, INestApplicationContext } from '@nestjs/common';
import { Pool } from 'pg';
import { encodeCp1252, generateRegister } from '../../tools/generate-legacy-data';
import { apiClient, TEST_PASSWORD } from '../support/api-client';
import { startApi } from '../support/app';
import { createTestPool } from '../support/db';
import { count, createRun, startWorker, waitForRun } from '../support/pipeline';

const REASON = 'Dry run report reviewed; quarantine rate is acceptable';

describe('maker-checker approvals', () => {
  let app: INestApplication;
  let worker: INestApplicationContext;
  let pool: Pool;
  let api: ReturnType<typeof apiClient>;
  let operator: { token: string; userId: string };
  let approver: string;
  let seed = 900;

  beforeAll(async () => {
    app = await startApi();
    worker = await startWorker();
    pool = createTestPool();
    api = apiClient(app, pool);
    operator = await api.login('operator');
    approver = (await api.login('approver')).token;
  });

  afterAll(async () => {
    await worker.close();
    await app.close();
    await pool.end();
  });

  const newProductionRun = async () => {
    const data = generateRegister({ rows: 100, seed: seed++, encoding: 'cp1252' });
    return (await createRun(api, operator.token, encodeCp1252(data.csv), 'production')).runId;
  };
  const submit = (runId: string) => api.as(operator.token).post(`/runs/${runId}/submit`);
  const decide = (runId: string, token: string, decision = 'approved', reason = REASON) =>
    api.as(token).post(`/runs/${runId}/approve`, { decision, reason });
  const start = (runId: string) => api.as(operator.token).post(`/runs/${runId}/start`);

  it('will not start a production run that has not been approved', async () => {
    const runId = await newProductionRun();
    const res = await start(runId).expect(409);
    expect(res.body.detail).toMatch(/needs approval/);
    await submit(runId).expect(200);
    await start(runId).expect(409);
  });

  it('runs once a different user approves it, and records who and why', async () => {
    const runId = await newProductionRun();
    expect((await submit(runId).expect(200)).body.status).toBe('awaiting_approval');
    const approved = await decide(runId, approver).expect(200);
    expect(approved.body.status).toBe('approved');

    await start(runId).expect(202);
    expect((await waitForRun(pool, runId)).status).toBe('completed');

    const history = await api.as(operator.token).get(`/runs/${runId}/approvals`).expect(200);
    expect(history.body).toEqual([
      expect.objectContaining({
        requestedBy: operator.userId,
        decision: 'approved',
        reason: REASON,
      }),
    ]);
    const { rows } = await pool.query(
      `SELECT reason FROM audit.events WHERE stream = $1 AND action = 'run.approved'`,
      [`run:${runId}`],
    );
    expect(rows).toEqual([{ reason: REASON }]);
  });

  it('returns 403 when the maker tries to approve their own run, even after becoming an approver', async () => {
    const runId = await newProductionRun();
    await submit(runId).expect(200);
    // The operator who submitted is promoted to approver and signs in again.
    const { rows } = await pool.query(
      `UPDATE control.users SET role = 'approver' WHERE id = $1 RETURNING email`,
      [operator.userId],
    );
    const login = await api
      .http()
      .post('/api/v1/auth/login')
      .send({ email: rows[0].email, password: TEST_PASSWORD })
      .expect(200);
    try {
      const res = await decide(runId, login.body.accessToken).expect(403);
      expect(res.body.detail).toBe('You cannot approve a run you created or submitted');
      const status = await api.as(approver).get(`/runs/${runId}`).expect(200);
      expect(status.body.status).toBe('awaiting_approval');
    } finally {
      await pool.query(`UPDATE control.users SET role = 'operator' WHERE id = $1`, [
        operator.userId,
      ]);
    }
  });

  it('forbids operators from approving at all', async () => {
    const runId = await newProductionRun();
    await submit(runId).expect(200);
    const otherOperator = (await api.login('operator')).token;
    await decide(runId, otherOperator).expect(403);
  });

  it('sends a rejected run back to draft with the reason, ready to resubmit', async () => {
    const runId = await newProductionRun();
    await submit(runId).expect(200);
    const rejected = await decide(runId, approver, 'rejected', 'Too many quarantined rows').expect(
      200,
    );
    expect(rejected.body.status).toBe('draft');
    await start(runId).expect(409);

    await submit(runId).expect(200);
    await decide(runId, approver).expect(200);
    const history = await api.as(operator.token).get(`/runs/${runId}/approvals`).expect(200);
    expect(history.body.map((a: { decision: string }) => a.decision)).toEqual([
      'rejected',
      'approved',
    ]);
  });

  it('requires a reason for every decision', async () => {
    const runId = await newProductionRun();
    await submit(runId).expect(200);
    const res = await api
      .as(approver)
      .post(`/runs/${runId}/approve`, { decision: 'approved' })
      .expect(400);
    expect(res.body.errors[0].path).toBe('reason');
  });

  it('expires a request that nobody decided within 24 hours', async () => {
    const runId = await newProductionRun();
    await submit(runId).expect(200);
    await pool.query(
      `UPDATE control.approvals SET expires_at = now() - interval '1 minute' WHERE run_id = $1`,
      [runId],
    );

    const res = await decide(runId, approver).expect(409);
    expect(res.body.detail).toMatch(/expired/);
    expect((await api.as(approver).get(`/runs/${runId}`).expect(200)).body.status).toBe('draft');
  });

  it('expires an approval that was not used to start the run within 24 hours', async () => {
    const runId = await newProductionRun();
    await submit(runId).expect(200);
    await decide(runId, approver).expect(200);
    await pool.query(
      `UPDATE control.approvals SET expires_at = now() - interval '1 minute' WHERE run_id = $1`,
      [runId],
    );

    const res = await start(runId).expect(409);
    expect(res.body.detail).toMatch(/approval expired/);
    expect((await api.as(approver).get(`/runs/${runId}`).expect(200)).body.status).toBe('draft');
    expect(
      await count(pool, 'SELECT count(*)::int n FROM control.batches WHERE run_id = $1', [runId]),
    ).toBe(0);
  });

  it('lets dry runs start without approval', async () => {
    const data = generateRegister({ rows: 50, seed: seed++, encoding: 'cp1252' });
    const { runId } = await createRun(api, operator.token, encodeCp1252(data.csv), 'dry_run');
    await submit(runId).expect(409);
    await start(runId).expect(202);
    expect((await waitForRun(pool, runId)).status).toBe('completed');
  });
});
