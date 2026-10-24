import { INestApplication, INestApplicationContext } from '@nestjs/common';
import { Pool } from 'pg';
import { encodeCp1252, generateRegister } from '../../tools/generate-legacy-data';
import { apiClient } from '../support/api-client';
import { startApi } from '../support/app';
import { createTestPool } from '../support/db';
import { count, createRun, startRun, startWorker, waitForRun } from '../support/pipeline';

/** Everything in target, in a stable order, so two snapshots compare exactly. */
async function snapshotTarget(pool: Pool) {
  const persons = await pool.query('SELECT * FROM target.persons ORDER BY id');
  const lineage = await pool.query(
    'SELECT * FROM target.lineage ORDER BY target_table, target_id, raw_row_id',
  );
  const households = await pool.query('SELECT * FROM target.households ORDER BY id');
  return { persons: persons.rows, lineage: lineage.rows, households: households.rows };
}

describe('reconciliation and rollback', () => {
  let app: INestApplication;
  let worker: INestApplicationContext;
  let pool: Pool;
  let api: ReturnType<typeof apiClient>;
  let operator: string;
  let auditor: string;
  let approver: string;

  beforeAll(async () => {
    app = await startApi();
    worker = await startWorker();
    pool = createTestPool();
    api = apiClient(app, pool);
    operator = (await api.login('operator')).token;
    auditor = (await api.login('auditor')).token;
    approver = (await api.login('approver')).token;
  });

  afterAll(async () => {
    await worker.close();
    await app.close();
    await pool.end();
  });

  async function completedRun(seed: number, rows = 1000) {
    const register = generateRegister({ rows, seed, encoding: 'cp1252' });
    const { runId } = await createRun(api, operator, encodeCp1252(register.csv), 'production');
    await startRun(api, operator, runId);
    const run = await waitForRun(pool, runId);
    expect(run.status).toBe('completed');
    return { runId, counts: run.counts };
  }

  it('writes a clean report: counts balance, every column checksum matches, the sample agrees', async () => {
    const { runId, counts } = await completedRun(501);
    const res = await api.as(auditor).get(`/runs/${runId}/reconciliation`).expect(200);

    expect(res.body).toMatchObject({
      ok: true,
      mode: 'production',
      counts: {
        profiled: 1000,
        extracted: 1000,
        loaded: counts.loaded,
        quarantined: counts.quarantined,
        balanced: true,
        problems: [],
      },
    });
    expect(res.body.checksums).toHaveLength(6);
    expect(res.body.checksums.every((c: { match: boolean }) => c.match)).toBe(true);
    expect(res.body.sample.size).toBe(20);
    expect(res.body.sample.mismatches).toEqual([]);
  });

  it('exports the report as CSV for auditors', async () => {
    const { runId } = await completedRun(502, 300);
    const res = await api.as(auditor).get(`/runs/${runId}/reconciliation?format=csv`).expect(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toContain(`reconciliation-${runId}.csv`);
    expect(res.text.split('\r\n')[0]).toBe('section,item,source,target,result');
    expect(res.text.match(/^checksum,.*,match$/gm)).toHaveLength(6);
  });

  it('keeps reports from operators', async () => {
    const { runId } = await completedRun(503, 100);
    await api.as(operator).get(`/runs/${runId}/reconciliation`).expect(403);
  });

  it('rollback leaves target exactly as it was before the run', async () => {
    const before = await snapshotTarget(pool);
    const { runId, counts } = await completedRun(504);
    expect(
      await count(pool, 'SELECT count(*)::int n FROM target.persons WHERE created_by_run = $1', [
        runId,
      ]),
    ).toBe(counts.loaded);

    const res = await api.as(approver).post(`/runs/${runId}/rollback`).expect(200);
    expect(res.body.status).toBe('rolled_back');

    expect(await snapshotTarget(pool)).toEqual(before);
    // Staged rows are valid again and every batch's rollback is in the run's audit trail.
    expect(
      await count(
        pool,
        `SELECT count(*)::int n FROM staging.staged_rows s JOIN staging.raw_rows r ON r.id = s.raw_row_id
         WHERE r.run_id = $1 AND s.status = 'loaded'`,
        [runId],
      ),
    ).toBe(0);
    expect(
      await count(
        pool,
        `SELECT count(*)::int n FROM audit.events WHERE stream = $1 AND action = 'batch.rolled_back'`,
        [`run:${runId}`],
      ),
    ).toBe(5);
  });

  it('refuses to roll back a run twice, or for an operator', async () => {
    const { runId } = await completedRun(505, 200);
    await api.as(operator).post(`/runs/${runId}/rollback`).expect(403);
    await api.as(approver).post(`/runs/${runId}/rollback`).expect(200);
    const again = await api.as(approver).post(`/runs/${runId}/rollback`).expect(409);
    expect(again.body.detail).toBe('A rolled_back run cannot be rolled back');
  });

  it('refuses to roll back a run whose records a later run has linked to', async () => {
    const first = await completedRun(506, 200);
    const later = await completedRun(507, 200);
    // As the matcher will do in a later phase: link a row of the later run to a person of the first.
    await pool.query(
      `INSERT INTO target.lineage (target_table, target_id, raw_row_id, mapping_id, run_id, batch_id)
       SELECT 'persons', (SELECT target_id FROM target.lineage WHERE run_id = $1 LIMIT 1),
              l.raw_row_id, l.mapping_id, l.run_id, l.batch_id
       FROM target.lineage l WHERE l.run_id = $2 LIMIT 1`,
      [first.runId, later.runId],
    );
    const res = await api.as(approver).post(`/runs/${first.runId}/rollback`).expect(409);
    expect(res.body.detail).toMatch(/Later runs have linked/);
  });
});
