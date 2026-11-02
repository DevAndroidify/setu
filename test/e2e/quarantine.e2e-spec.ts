import { INestApplication, INestApplicationContext } from '@nestjs/common';
import { Pool } from 'pg';
import { encodeCp1252, generateRegister } from '../../tools/generate-legacy-data';
import { apiClient } from '../support/api-client';
import { startApi } from '../support/app';
import { createTestPool } from '../support/db';
import { count, createRun, startRun, startWorker, waitForRun } from '../support/pipeline';

type Entry = {
  id: string;
  runId: string;
  rowNo: number;
  stage: string;
  reasons: { field: string; message: string }[];
  raw: Record<string, string>;
  corrected: Record<string, string> | null;
};

const BATCH = 200; // PIPELINE_BATCH_SIZE in tests

describe('fixing and retrying quarantined rows', () => {
  let app: INestApplication;
  let worker: INestApplicationContext;
  let pool: Pool;
  let api: ReturnType<typeof apiClient>;
  let operator: string;

  beforeAll(async () => {
    app = await startApi();
    worker = await startWorker();
    pool = createTestPool();
    api = apiClient(app, pool);
    operator = (await api.login('operator')).token;
  });

  afterAll(async () => {
    await worker.close();
    await app.close();
    await pool.end();
  });

  const completedRun = async (seed: number, mode: 'dry_run' | 'production') => {
    const register = generateRegister({ rows: 1000, seed, encoding: 'cp1252' });
    const { runId } = await createRun(api, operator, encodeCp1252(register.csv), mode);
    await startRun(api, operator, runId);
    const run = await waitForRun(pool, runId);
    expect(run.status).toBe('completed');
    return { runId, counts: run.counts };
  };

  const quarantined = async (runId: string): Promise<Entry[]> => {
    const all: Entry[] = [];
    let cursor: string | null = null;
    do {
      const res: { body: { data: Entry[]; nextCursor: string | null } } = await api
        .as(operator)
        .get(`/quarantine?runId=${runId}&limit=200${cursor ? `&cursor=${cursor}` : ''}`)
        .expect(200);
      all.push(...res.body.data);
      cursor = res.body.nextCursor;
    } while (cursor);
    return all;
  };

  /** Rows whose only problem is an impossible BS date of birth, so fixing the date fixes them. */
  const onlyBadDate = (entries: Entry[]) =>
    entries.filter(
      (e) =>
        e.stage === 'transform' &&
        e.reasons.length === 1 &&
        e.reasons[0]!.field === 'dob_ad' &&
        /not a real BS date/.test(e.reasons[0]!.message),
    );

  const fix = (id: string, values: Record<string, string>) =>
    api.as(operator).patch(`/quarantine/${id}`, { values });

  it('reopens a production run for fixed rows from separate batches and reconciles it again', async () => {
    const { runId, counts } = await completedRun(3131, 'production');
    const candidates = onlyBadDate(await quarantined(runId));
    // Two rows in batches that are not next to each other.
    const first = candidates.find((e) => e.rowNo <= BATCH)!;
    const later = candidates.find((e) => e.rowNo > 3 * BATCH)!;
    expect(first && later).toBeTruthy();

    const res = await fix(first.id, { JANMA_MITI: '2045/1/15' }).expect(200);
    expect(res.body).toMatchObject({
      corrected: { JANMA_MITI: '2045/1/15' },
      result: { status: 'valid' },
    });
    expect(res.body.result.values.dob_ad).toMatch(/^1988-04-2\d$/);
    await fix(later.id, { JANMA_MITI: '2050-06-10' }).expect(200);

    const retry = await api.as(operator).post('/quarantine/retry', { runId }).expect(200);
    expect(retry.body).toEqual({ retried: 2, passed: 2, stillFailing: 0, reopened: true });

    const done = await waitForRun(pool, runId);
    expect(done.status).toBe('completed');
    expect(done.counts.quarantined).toBe(counts.quarantined! - 2);
    const placed = (c: Record<string, number>) => c.loaded! + c.linked! + c.review!;
    expect(placed(done.counts)).toBe(placed(counts) + 2);

    const left = (await quarantined(runId)).map((e) => e.id);
    expect(left).not.toContain(first.id);
    expect(left).not.toContain(later.id);
    const auditor = (await api.login('auditor')).token;
    const report = await api.as(auditor).get(`/runs/${runId}/reconciliation`).expect(200);
    expect(report.body).toMatchObject({ ok: true, counts: { balanced: true } });
  });

  it('keeps a row quarantined, with the new reasons, when its fix still fails', async () => {
    const { runId } = await completedRun(3132, 'production');
    const [entry] = onlyBadDate(await quarantined(runId));
    const res = await fix(entry!.id, { JANMA_MITI: '2045/14/1' }).expect(200);
    expect(res.body.result.status).toBe('quarantined');

    const retry = await api
      .as(operator)
      .post('/quarantine/retry', { runId, ids: [entry!.id] })
      .expect(200);
    expect(retry.body).toEqual({ retried: 1, passed: 0, stillFailing: 1, reopened: false });
    const again = await api.as(operator).get(`/quarantine/${entry!.id}`).expect(200);
    expect(again.body).toMatchObject({ corrected: { JANMA_MITI: '2045/14/1' }, resolvedAt: null });
    expect(JSON.stringify(again.body.reasons)).toContain('2045-14-01 is not a real BS date');
    const { rows } = await pool.query('SELECT status FROM control.runs WHERE id = $1', [runId]);
    expect(rows[0].status).toBe('completed');
  });

  it('recounts a dry run at once: no worker step is needed', async () => {
    const { runId, counts } = await completedRun(3133, 'dry_run');
    const [entry] = onlyBadDate(await quarantined(runId));
    await fix(entry!.id, { JANMA_MITI: '2045/1/15' }).expect(200);
    await api.as(operator).post('/quarantine/retry', { runId }).expect(200);
    const done = await waitForRun(pool, runId);
    expect(done.counts).toMatchObject({
      valid: counts.valid! + 1,
      quarantined: counts.quarantined! - 1,
    });
  });

  it('audits each fix by column name, never by value', async () => {
    const { runId } = await completedRun(3134, 'dry_run');
    const [entry] = onlyBadDate(await quarantined(runId));
    await fix(entry!.id, { JANMA_MITI: '2046/2/2' }).expect(200);
    const { rows } = await pool.query(
      `SELECT payload FROM audit.events WHERE stream = $1 AND action = 'quarantine.corrected'`,
      [`run:${runId}`],
    );
    expect(rows).toEqual([{ payload: { rowNo: entry!.rowNo, columns: ['JANMA_MITI'] } }]);
    expect(JSON.stringify(rows)).not.toContain('2046/2/2');
  });

  it('refuses unknown columns, other roles, and runs that are not completed', async () => {
    const { runId } = await completedRun(3135, 'dry_run');
    const [entry] = onlyBadDate(await quarantined(runId));
    const unknown = await fix(entry!.id, { NOT_A_COLUMN: 'x' }).expect(400);
    expect(unknown.body.detail).toBe('The file has no column NOT_A_COLUMN');

    const admin = (await api.login('admin')).token;
    await api
      .as(admin)
      .patch(`/quarantine/${entry!.id}`, { values: { JANMA_MITI: '2045/1/1' } })
      .expect(403);

    await pool.query(`UPDATE control.runs SET status = 'cancelled' WHERE id = $1`, [runId]);
    const cancelled = await fix(entry!.id, { JANMA_MITI: '2045/1/1' }).expect(409);
    expect(cancelled.body.detail).toMatch(/once the run has completed/);
    await api.as(operator).post('/quarantine/retry', { runId }).expect(409);
  });

  it('finds the run’s batches again after a retry, so nothing is left unmatched', async () => {
    // The first test reopened batch 1 and batch 4+; every batch of every run must be done now.
    expect(
      await count(
        pool,
        `SELECT count(*)::int n FROM control.batches WHERE stage <> 'done' AND run_id IN (SELECT id FROM control.runs WHERE status = 'completed')`,
        [],
      ),
    ).toBe(0);
  });
});
