import { INestApplication, INestApplicationContext } from '@nestjs/common';
import { Pool } from 'pg';
import { StagesService } from '../../src/modules/pipeline/stages.service';
import { encodeCp1252, generateRegister } from '../../tools/generate-legacy-data';
import { apiClient } from '../support/api-client';
import { startApi } from '../support/app';
import { createTestPool } from '../support/db';
import { count, createRun, startRun, startWorker, waitForRun } from '../support/pipeline';

const register = generateRegister({ rows: 1000, seed: 4242, encoding: 'cp1252' });
const bytes = encodeCp1252(register.csv);

describe('pipeline', () => {
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

  describe('with a worker running', () => {
    let worker: INestApplicationContext;
    let production: { runId: string; counts: Record<string, number> };

    beforeAll(async () => {
      worker = await startWorker();
      // Every upload must be unique (sha256), so each run gets its own copy of the register.
      const { runId } = await createRun(api, operator, bytes, 'production');
      await startRun(api, operator, runId);
      const run = await waitForRun(pool, runId);
      production = { runId, counts: run.counts };
      expect(run.status).toBe('completed');
    });

    afterAll(async () => {
      await worker.close();
    });

    it('accounts for every row: loaded + quarantined = total', () => {
      const { total, loaded, quarantined } = production.counts;
      expect(total).toBe(1000);
      expect(loaded! + quarantined!).toBe(total);
      expect(loaded).toBeGreaterThan(800);
    });

    it('writes one person and one lineage link per loaded row', async () => {
      const { runId, counts } = production;
      const persons = await count(
        pool,
        'SELECT count(*)::int n FROM target.persons WHERE created_by_run = $1',
        [runId],
      );
      const lineage = await count(
        pool,
        'SELECT count(*)::int n FROM target.lineage WHERE run_id = $1',
        [runId],
      );
      const distinctRows = await count(
        pool,
        'SELECT count(DISTINCT raw_row_id)::int n FROM target.lineage WHERE run_id = $1',
        [runId],
      );
      expect(persons).toBe(counts.loaded);
      expect(lineage).toBe(counts.loaded);
      expect(distinctRows).toBe(counts.loaded);
    });

    it('quarantines every row with a planted impossible date, with the reason', async () => {
      const planted = register.truth.anomalies
        .filter((a) => a.kind === 'impossible_dob')
        .map((a) => a.row);
      const { rows } = await pool.query(
        `SELECT r.row_no, q.stage, q.reasons FROM staging.quarantine q
         JOIN staging.staged_rows s ON s.id = q.staged_row_id
         JOIN staging.raw_rows r ON r.id = s.raw_row_id
         WHERE r.run_id = $1 AND r.row_no = ANY($2)`,
        [production.runId, planted],
      );
      expect(rows.map((r) => r.row_no).sort((a, b) => a - b)).toEqual(planted);
      for (const row of rows) {
        expect(row.stage).toBe('transform');
        expect(JSON.stringify(row.reasons)).toContain('is not a real BS date');
      }
    });

    it('holds a second record with an already-loaded citizenship number for review', async () => {
      const { rows } = await pool.query(
        `SELECT count(*)::int n FROM staging.quarantine q
         JOIN staging.staged_rows s ON s.id = q.staged_row_id
         JOIN staging.raw_rows r ON r.id = s.raw_row_id
         WHERE r.run_id = $1 AND q.stage = 'load'`,
        [production.runId],
      );
      // The generator re-enters some people with their citizenship number.
      expect(rows[0].n).toBeGreaterThan(0);
    });

    it('lists quarantined rows with their raw values and reasons', async () => {
      const res = await api
        .as(operator)
        .get(`/quarantine?runId=${production.runId}&stage=transform&limit=5`)
        .expect(200);
      expect(res.body.data).toHaveLength(5);
      expect(res.body.data[0]).toMatchObject({
        runId: production.runId,
        stage: 'transform',
        raw: expect.objectContaining({ NAAM: expect.any(String) }),
        reasons: expect.any(Array),
      });
    });

    it('changes nothing when every stage of a finished run is run again', async () => {
      const { runId } = production;
      const before = await pool.query(
        `SELECT (SELECT count(*) FROM target.persons WHERE created_by_run = $1) persons,
                (SELECT count(*) FROM target.lineage WHERE run_id = $1) lineage,
                (SELECT count(*) FROM staging.raw_rows WHERE run_id = $1) raw`,
        [runId],
      );
      const stages = worker.get(StagesService);
      const { rows: batches } = await pool.query(
        'SELECT id FROM control.batches WHERE run_id = $1',
        [runId],
      );
      for (const { id } of batches) {
        await stages.transform(id);
        await stages.validate(id);
        await stages.load(id);
      }
      await stages.extract(runId);
      const after = await pool.query(
        `SELECT (SELECT count(*) FROM target.persons WHERE created_by_run = $1) persons,
                (SELECT count(*) FROM target.lineage WHERE run_id = $1) lineage,
                (SELECT count(*) FROM staging.raw_rows WHERE run_id = $1) raw`,
        [runId],
      );
      expect(after.rows).toEqual(before.rows);
    });

    it('validates a dry run without loading anything', async () => {
      const dry = generateRegister({ rows: 600, seed: 7, encoding: 'cp1252' });
      const { runId } = await createRun(api, operator, encodeCp1252(dry.csv), 'dry_run');
      await startRun(api, operator, runId);
      const run = await waitForRun(pool, runId);

      expect(run.status).toBe('completed');
      expect(run.counts).toMatchObject({ total: 600, loaded: 0 });
      expect(run.counts.valid! + run.counts.quarantined!).toBe(600);
      expect(
        await count(pool, 'SELECT count(*)::int n FROM target.persons WHERE created_by_run = $1', [
          runId,
        ]),
      ).toBe(0);
    });

    it('starts a run only once, however many times start is called', async () => {
      const once = generateRegister({ rows: 50, seed: 8, encoding: 'cp1252' });
      const { runId } = await createRun(api, operator, encodeCp1252(once.csv), 'dry_run');
      await Promise.all([
        api.as(operator).post(`/runs/${runId}/start`).expect(202),
        api.as(operator).post(`/runs/${runId}/start`).expect(202),
      ]);
      await waitForRun(pool, runId);
      const started = await count(
        pool,
        `SELECT count(*)::int n FROM audit.events WHERE stream = $1 AND action = 'run.started'`,
        [`run:${runId}`],
      );
      expect(started).toBe(1);
    });

    it('shows progress and the final counts on GET /runs/:id', async () => {
      const res = await api.as(operator).get(`/runs/${production.runId}`).expect(200);
      expect(res.body).toMatchObject({
        status: 'completed',
        counts: production.counts,
        progress: { loaded: production.counts.loaded, batches: { done: 5 } },
      });
    });

    it('finishes a queued run whose extract job was lost before it reached the queue', async () => {
      const lost = generateRegister({ rows: 100, seed: 12, encoding: 'cp1252' });
      const { runId } = await createRun(api, operator, encodeCp1252(lost.csv), 'dry_run');
      // As if the API crashed after marking the run queued but before queuing its job.
      await pool.query(`UPDATE control.runs SET status = 'queued' WHERE id = $1`, [runId]);
      const run = await waitForRun(pool, runId, ['completed', 'failed'], 20_000);
      expect(run).toMatchObject({ status: 'completed', counts: { total: 100 } });
    });

    it('forbids a reviewer from starting runs', async () => {
      const reviewer = (await api.login('reviewer')).token;
      await api.as(reviewer).post(`/runs/${production.runId}/start`).expect(403);
    });
  });

  describe('pause, resume and cancel', () => {
    // No worker runs until each test starts one, so the run's position is known exactly.
    it('does no work while paused and finishes after resume', async () => {
      const data = generateRegister({ rows: 400, seed: 9, encoding: 'cp1252' });
      const { runId } = await createRun(api, operator, encodeCp1252(data.csv), 'production');
      await startRun(api, operator, runId);
      await api.as(operator).post(`/runs/${runId}/pause`).expect(200);

      const worker = await startWorker();
      try {
        await new Promise((r) => setTimeout(r, 2000));
        const paused = await waitForRun(pool, runId, ['paused']);
        expect(paused.status).toBe('paused');
        expect(
          await count(pool, 'SELECT count(*)::int n FROM staging.raw_rows WHERE run_id = $1', [
            runId,
          ]),
        ).toBe(0);

        await api.as(operator).post(`/runs/${runId}/resume`).expect(202);
        const done = await waitForRun(pool, runId);
        expect(done.status).toBe('completed');
        expect(done.counts.loaded! + done.counts.quarantined!).toBe(400);
      } finally {
        await worker.close();
      }
    });

    it('refuses to resume a run that is not paused', async () => {
      const data = generateRegister({ rows: 20, seed: 10, encoding: 'cp1252' });
      const { runId } = await createRun(api, operator, encodeCp1252(data.csv), 'dry_run');
      const res = await api.as(operator).post(`/runs/${runId}/resume`).expect(409);
      expect(res.body.detail).toBe('A draft run cannot be moved to running');
    });

    it('never runs a cancelled run', async () => {
      const data = generateRegister({ rows: 200, seed: 11, encoding: 'cp1252' });
      const { runId } = await createRun(api, operator, encodeCp1252(data.csv), 'production');
      await startRun(api, operator, runId);
      await api.as(operator).post(`/runs/${runId}/cancel`).expect(200);

      const worker = await startWorker();
      try {
        await new Promise((r) => setTimeout(r, 2000));
        expect((await waitForRun(pool, runId, ['cancelled'])).status).toBe('cancelled');
        expect(
          await count(pool, 'SELECT count(*)::int n FROM control.batches WHERE run_id = $1', [
            runId,
          ]),
        ).toBe(0);
        await api.as(operator).post(`/runs/${runId}/resume`).expect(409);
      } finally {
        await worker.close();
      }
    });
  });
});
