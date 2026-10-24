import { INestApplication, INestApplicationContext } from '@nestjs/common';
import { ChildProcess, spawn } from 'node:child_process';
import { join } from 'node:path';
import { Pool } from 'pg';
import { AuditService } from '../../src/modules/audit/audit.service';
import { encodeCp1252, generateRegister } from '../../tools/generate-legacy-data';
import { apiClient } from '../support/api-client';
import { startApi } from '../support/app';
import { createTestPool } from '../support/db';
import { count, createRun, startRun, startWorker, waitForRun } from '../support/pipeline';

// Small batches, short locks: the crashed worker's jobs come back within seconds.
const CRASH_ENV = {
  PIPELINE_BATCH_SIZE: '100',
  PIPELINE_CONCURRENCY: '1',
  PIPELINE_LOCK_MS: '3000',
  PIPELINE_STALE_SECONDS: '3',
  PIPELINE_SWEEP_MS: '1000',
};
const ROWS = 3000;

describe('pipeline crash recovery', () => {
  let app: INestApplication;
  let pool: Pool;
  let child: ChildProcess | undefined;
  let worker: INestApplicationContext | undefined;

  beforeAll(async () => {
    Object.assign(process.env, CRASH_ENV);
    app = await startApi();
    pool = createTestPool();
  });

  afterAll(async () => {
    child?.kill('SIGKILL');
    await worker?.close();
    await app.close();
    await pool.end();
  });

  it('finishes a run after its worker is killed mid-run, with no duplicates', async () => {
    const api = apiClient(app, pool);
    const operator = (await api.login('operator')).token;
    const register = generateRegister({ rows: ROWS, seed: 2024, encoding: 'cp1252' });
    const { runId } = await createRun(api, operator, encodeCp1252(register.csv), 'production');

    // A real worker process, so it can be killed without any chance to clean up.
    child = spawn(process.execPath, [join(__dirname, '../../dist/apps/worker/main.js')], {
      env: { ...process.env, ...CRASH_ENV, LOG_LEVEL: 'error' },
      stdio: 'ignore',
    });
    await startRun(api, operator, runId);

    const doneBatches = () =>
      count(
        pool,
        `SELECT count(*)::int n FROM control.batches WHERE run_id = $1 AND stage = 'done'`,
        [runId],
      );
    const deadline = Date.now() + 60_000;
    while ((await doneBatches()) < 5) {
      if (Date.now() > deadline) throw new Error('worker made no progress');
      await new Promise((r) => setTimeout(r, 50));
    }
    child.kill('SIGKILL');
    const atCrash = await waitForRun(pool, runId, ['running', 'completed']);
    expect(atCrash.status).toBe('running'); // killed mid-run, not after

    worker = await startWorker();
    const run = await waitForRun(pool, runId, ['completed', 'failed'], 120_000);
    expect(run.status).toBe('completed');

    const { total, loaded, linked, quarantined, review } = run.counts;
    expect(total).toBe(ROWS);
    expect(loaded! + linked! + quarantined! + review!).toBe(ROWS);

    const q = (sql: string) => count(pool, sql, [runId]);
    expect(await q('SELECT count(*)::int n FROM staging.raw_rows WHERE run_id = $1')).toBe(ROWS);
    expect(
      await q(`SELECT count(*)::int n FROM staging.staged_rows s
               JOIN staging.raw_rows r ON r.id = s.raw_row_id WHERE r.run_id = $1`),
    ).toBe(ROWS);
    expect(await q('SELECT count(*)::int n FROM target.persons WHERE created_by_run = $1')).toBe(
      loaded,
    );
    expect(await q('SELECT count(*)::int n FROM target.lineage WHERE run_id = $1')).toBe(
      loaded! + linked!,
    );
    expect(
      await q(`SELECT count(*)::int n FROM (
                 SELECT raw_row_id FROM target.lineage WHERE run_id = $1
                 GROUP BY raw_row_id HAVING count(*) > 1) d`),
    ).toBe(0);
    expect(
      await q(`SELECT count(*)::int n FROM staging.quarantine q
               JOIN staging.staged_rows s ON s.id = q.staged_row_id
               JOIN staging.raw_rows r ON r.id = s.raw_row_id WHERE r.run_id = $1`),
    ).toBe(quarantined);

    // One batch.loaded event per batch, and the run's audit chain is intact.
    expect(
      await count(
        pool,
        `SELECT count(*)::int n FROM audit.events WHERE stream = $1 AND action = 'batch.loaded'`,
        [`run:${runId}`],
      ),
    ).toBe(ROWS / 100);
    expect(await app.get(AuditService).verify(`run:${runId}`)).toMatchObject({ valid: true });
  });
});
