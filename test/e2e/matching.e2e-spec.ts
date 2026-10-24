import { INestApplication, INestApplicationContext } from '@nestjs/common';
import { Pool } from 'pg';
import { encodeCp1252, generateRegister } from '../../tools/generate-legacy-data';
import { apiClient } from '../support/api-client';
import { startApi } from '../support/app';
import { createTestPool } from '../support/db';
import { count, createRun, startRun, startWorker, waitForRun } from '../support/pipeline';

const register = generateRegister({ rows: 1000, seed: 1414, encoding: 'cp1252' });
const col = (name: string) => register.header.indexOf(name);
const toCsv = (rows: string[][]) =>
  encodeCp1252([register.header, ...rows].map((r) => r.join(',')).join('\r\n') + '\r\n');

describe('duplicate matching', () => {
  let app: INestApplication;
  let worker: INestApplicationContext;
  let pool: Pool;
  let api: ReturnType<typeof apiClient>;
  let operator: string;
  let reviewer: string;
  let first: { runId: string; counts: Record<string, number> };

  const statusOf = async (runId: string) => {
    const { rows } = await pool.query<{ row_no: number; status: string; id: string }>(
      `SELECT r.row_no, s.status, s.id FROM staging.staged_rows s
       JOIN staging.raw_rows r ON r.id = s.raw_row_id WHERE r.run_id = $1`,
      [runId],
    );
    return new Map(rows.map((r) => [r.row_no, r]));
  };

  const completedRun = async (bytes: Buffer) => {
    const { runId } = await createRun(api, operator, bytes, 'production');
    await startRun(api, operator, runId);
    const run = await waitForRun(pool, runId);
    expect(run.status).toBe('completed');
    return { runId, counts: run.counts };
  };

  beforeAll(async () => {
    app = await startApi();
    worker = await startWorker();
    pool = createTestPool();
    api = apiClient(app, pool);
    operator = (await api.login('operator')).token;
    reviewer = (await api.login('reviewer')).token;
    first = await completedRun(encodeCp1252(register.csv));
  });

  afterAll(async () => {
    await worker.close();
    await app.close();
    await pool.end();
  });

  it('accounts for every row: loaded + linked + quarantined + held for review = total', () => {
    const { total, loaded, linked, quarantined, review } = first.counts;
    expect(loaded! + linked! + quarantined! + review!).toBe(total);
    expect(linked).toBeGreaterThan(0);
  });

  it('finds every planted duplicate whose two rows passed validation with the same birth date', async () => {
    const status = await statusOf(first.runId);
    const testable = register.truth.duplicates.filter(
      (d) =>
        status.get(d.row)!.status !== 'quarantined' &&
        status.get(d.duplicateOf)!.status !== 'quarantined',
    );
    const { rows: normalized } = await pool.query<{ row_no: number; dob: string | null }>(
      `SELECT r.row_no, s.normalized->>'dob_ad' dob FROM staging.staged_rows s
       JOIN staging.raw_rows r ON r.id = s.raw_row_id WHERE r.run_id = $1`,
      [first.runId],
    );
    const dob = new Map(normalized.map((n) => [n.row_no, n.dob]));
    // The dates may be written in different formats in the file; compare what staging made.
    const expected = testable.filter(
      (d) => dob.get(d.row) && dob.get(d.row) === dob.get(d.duplicateOf),
    );
    expect(expected.length).toBeGreaterThan(20);

    for (const d of expected) {
      expect([d.row, status.get(d.row)!.status]).toEqual([d.row, 'linked']);
      const { rows } = await pool.query(
        `SELECT row_b FROM staging.match_candidates WHERE row_a = $1`,
        [status.get(d.row)!.id],
      );
      expect(rows).toEqual([{ row_b: status.get(d.duplicateOf)!.id }]);
    }
  });

  it('creates no second person for a linked row, only lineage to the first one', async () => {
    const { runId, counts } = first;
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
    expect(persons).toBe(counts.loaded);
    expect(lineage).toBe(counts.loaded! + counts.linked!);
  });

  it('keeps the reconciliation report balanced with linked rows', async () => {
    const auditor = (await api.login('auditor')).token;
    const report = await api.as(auditor).get(`/runs/${first.runId}/reconciliation`).expect(200);
    expect(report.body).toMatchObject({
      ok: true,
      counts: { balanced: true, linked: first.counts.linked },
    });
  });

  describe('a later run re-entering the same people', () => {
    let later: { runId: string; counts: Record<string, number> };
    const sample = register.rows.slice(0, 300);

    beforeAll(async () => {
      // The same people again. A third are entered exactly as before. In the rest, where a
      // citizenship number is known the clerk left out the birth date, so the row can only be
      // matched by number; elsewhere the father's given name differs (Shyam). Both kinds need
      // a reviewer.
      const BABU = col('BABU_NAAM');
      const rows = sample.map((row, i) => {
        const copy = [...row];
        if (i % 3 === 0) return copy;
        if (copy[col('NAGARIKTA_NO')]) copy[col('JANMA_MITI')] = '';
        else copy[BABU] = ['Zofd', ...copy[BABU]!.split(' ').slice(1)].join(' ');
        return copy;
      });
      later = await completedRun(toCsv(rows));
    });

    const pending = async () =>
      (await api.as(reviewer).get(`/matches?runId=${later.runId}&limit=200`).expect(200)).body;

    it('links people whose details all agree to the persons the first run loaded', async () => {
      expect(later.counts.linked).toBeGreaterThan(50);
      const { rows } = await pool.query(
        `SELECT count(*)::int n FROM target.lineage l JOIN target.persons p ON p.id = l.target_id
         WHERE l.run_id = $1 AND p.created_by_run = $2`,
        [later.runId, first.runId],
      );
      expect(rows[0].n).toBeGreaterThan(50);
    });

    const byNumber = async () =>
      (await pending()).data.filter(
        (c: { features: { citizenship: string } }) => c.features.citizenship === 'same',
      );
    const byDetails = async () =>
      (await pending()).data.filter(
        (c: { features: { citizenship: string } }) => c.features.citizenship === 'unknown',
      );

    it('holds rows that only share a citizenship number for review, without showing the number', async () => {
      const body = await pending();
      const [candidate] = await byNumber();
      expect(body.data.length).toBeGreaterThan(5);
      expect(candidate).toMatchObject({
        score: expect.any(Number),
        features: { citizenship: 'same' },
        row: { runId: later.runId, hasCitizenshipNo: true, dob_ad: null },
        match: { runId: first.runId, status: 'loaded' },
      });
      expect(JSON.stringify(body)).not.toMatch(/\d{2}-\d{2}-\d{2}-\d{5}/);
    });

    it('keeps the review queue from operators', async () => {
      await api.as(operator).get('/matches').expect(403);
    });

    it('links a held row to the matched person when the reviewer decides so, with the reason', async () => {
      const [candidate] = await byNumber();
      const res = await api
        .as(reviewer)
        .post(`/matches/${candidate.id}/decision`, {
          decision: 'link',
          reason: 'Same number and name',
        })
        .expect(200);
      expect(res.body).toMatchObject({ decision: 'link', rowStatus: 'linked' });

      const { rows } = await pool.query(
        `SELECT p.created_by_run FROM target.lineage l
         JOIN staging.staged_rows s ON s.raw_row_id = l.raw_row_id
         JOIN target.persons p ON p.id = l.target_id WHERE s.id = $1`,
        [candidate.row.stagedRowId],
      );
      expect(rows).toEqual([{ created_by_run: first.runId }]);
      const audit = await pool.query(
        `SELECT reason FROM audit.events WHERE stream = $1 AND action = 'match.decided'`,
        [`run:${later.runId}`],
      );
      expect(audit.rows).toEqual([{ reason: 'Same number and name' }]);
      await api
        .as(reviewer)
        .post(`/matches/${candidate.id}/decision`, { decision: 'link', reason: 'again' })
        .expect(404);
    });

    it('refuses to load a held row as a new person while its citizenship number is taken', async () => {
      const [candidate] = await byNumber();
      const res = await api
        .as(reviewer)
        .post(`/matches/${candidate.id}/decision`, {
          decision: 'not_same',
          reason: 'Different person',
        })
        .expect(409);
      expect(res.body.detail).toMatch(/link it instead/);
    });

    it('loads a held row as a new person when the reviewer decides it is someone else', async () => {
      const [candidate] = await byDetails();
      expect(candidate.features).toMatchObject({ name: 1, dob: 1 });
      await api
        .as(reviewer)
        .post(`/matches/${candidate.id}/decision`, {
          decision: 'not_same',
          reason: 'Different father: a namesake',
        })
        .expect(200);
      const { rows } = await pool.query(
        `SELECT p.created_by_run FROM target.lineage l
         JOIN staging.staged_rows s ON s.raw_row_id = l.raw_row_id
         JOIN target.persons p ON p.id = l.target_id WHERE s.id = $1`,
        [candidate.row.stagedRowId],
      );
      expect(rows).toEqual([{ created_by_run: later.runId }]);
    });

    it('requires a reason for a decision', async () => {
      const [candidate] = (await pending()).data;
      await api
        .as(reviewer)
        .post(`/matches/${candidate.id}/decision`, { decision: 'link' })
        .expect(400);
    });

    it('rolls back the later run without touching the persons it linked to', async () => {
      const before = await count(
        pool,
        'SELECT count(*)::int n FROM target.persons WHERE created_by_run = $1',
        [first.runId],
      );
      const approver = (await api.login('approver')).token;
      await api.as(approver).post(`/runs/${first.runId}/rollback`).expect(409);
      await api.as(approver).post(`/runs/${later.runId}/rollback`).expect(200);
      const after = await count(
        pool,
        'SELECT count(*)::int n FROM target.persons WHERE created_by_run = $1',
        [first.runId],
      );
      expect(after).toBe(before);
      expect(
        await count(pool, 'SELECT count(*)::int n FROM target.lineage WHERE run_id = $1', [
          later.runId,
        ]),
      ).toBe(0);
    });
  });
});
