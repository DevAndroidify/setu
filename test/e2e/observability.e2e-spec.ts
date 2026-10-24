import { INestApplication, INestApplicationContext } from '@nestjs/common';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { MetricsServer } from '../../src/jobs/metrics.server';
import { encodeCp1252, generateRegister } from '../../tools/generate-legacy-data';
import { apiClient } from '../support/api-client';
import { startApi } from '../support/app';
import { createTestPool } from '../support/db';
import { createRun, startRun, startWorker, waitForRun } from '../support/pipeline';

const register = generateRegister({ rows: 600, seed: 1515, encoding: 'cp1252' });
const column = (name: string) =>
  register.rows.map((r) => r[register.header.indexOf(name)]!).filter((v) => v.trim() !== '');

/** Reads a Server-Sent Events response to its end and returns each event's data. */
const sseEvents = (text: string) =>
  text
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice('data: '.length)));

describe('observability', () => {
  const logFile = join(mkdtempSync(join(tmpdir(), 'setu-logs-')), 'test.log');
  const saved = { LOG_FILE: process.env.LOG_FILE, LOG_LEVEL: process.env.LOG_LEVEL };
  let app: INestApplication;
  let worker: INestApplicationContext;
  let pool: Pool;
  let api: ReturnType<typeof apiClient>;
  let operator: string;
  let runId: string;

  beforeAll(async () => {
    // Everything both processes log, at the most verbose level, goes to one file.
    Object.assign(process.env, { LOG_FILE: logFile, LOG_LEVEL: 'trace' });
    app = await startApi();
    worker = await startWorker();
    pool = createTestPool();
    api = apiClient(app, pool);
    operator = (await api.login('operator')).token;

    // A run through every stage, plus the requests most likely to carry personal data.
    ({ runId } = await createRun(api, operator, encodeCp1252(register.csv), 'production'));
    await startRun(api, operator, runId);
    expect((await waitForRun(pool, runId)).status).toBe('completed');

    const auditor = (await api.login('auditor')).token;
    const reviewer = (await api.login('reviewer')).token;
    const persons = (await api.as(operator).get('/persons?limit=5').expect(200)).body.data;
    await api
      .as(operator)
      .get(`/persons?q=${encodeURIComponent(persons[0].name_en)}`)
      .expect(200);
    await api
      .as(auditor)
      .get(`/persons/${persons[0].id}?unmask=true&reason=Checking%20a%20complaint`)
      .expect(200);
    await api.as(reviewer).get(`/matches?runId=${runId}`).expect(200);
    await api.as(operator).get(`/quarantine?runId=${runId}`).expect(200);
    await api.http().post('/api/v1/auth/login').send({ email: 'nobody@setu.local', password: 'x' });
  }, 120_000);

  afterAll(async () => {
    await worker.close();
    await app.close();
    await pool.end();
    Object.assign(process.env, saved);
    if (saved.LOG_FILE === undefined) delete process.env.LOG_FILE;
  });

  describe('logs', () => {
    let log: string;
    beforeAll(() => {
      log = readFileSync(logFile, 'utf8');
    });

    it('are JSON lines with the request id, path and user of each request', () => {
      const lines = log
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l));
      const requests = lines.filter((l) => l.req && l.res);
      expect(requests.length).toBeGreaterThan(10);
      expect(requests.find((l) => l.req.path === '/api/v1/persons')).toMatchObject({
        req: { id: expect.any(String), method: 'GET' },
        userId: expect.any(String),
      });
    });

    it('contain no citizenship numbers', () => {
      const numbers = column('NAGARIKTA_NO');
      expect(numbers.length).toBeGreaterThan(100);
      for (const number of numbers) expect(log).not.toContain(number);
    });

    it('contain no names, in English, Nepali or Preeti, and no search terms', () => {
      const names = new Set([...column('NAAM'), ...column('BABU_NAAM')]);
      const english = new Set(
        column('NAAM_EN').map((n) =>
          n
            .trim()
            .toLowerCase()
            .replace(/\b\w/g, (c) => c.toUpperCase()),
        ),
      );
      for (const name of [...names, ...english]) expect(log).not.toContain(name);
      expect(log).not.toContain('q=');
    });
  });

  it('serves API metrics: request durations by route and queue depth', async () => {
    const res = await api.http().get('/metrics').expect(200);
    expect(res.text).toMatch(
      /setu_http_request_duration_seconds_count\{method="GET",route="\/api\/v1\/persons\/:id",status="200"\} \d+/,
    );
    expect(res.text).toMatch(/setu_queue_waiting\{queue="pipeline-load"\} \d+/);
  });

  it('serves worker metrics: rows per stage and outcome, and batch durations', async () => {
    const port = worker.get(MetricsServer).port;
    const text = await (await fetch(`http://127.0.0.1:${port}/metrics`)).text();
    expect(text).toMatch(/setu_rows_processed_total\{stage="load",status="loaded"\} [1-9]\d*/);
    expect(text).toMatch(
      /setu_rows_processed_total\{stage="transform",status="quarantined"\} [1-9]/,
    );
    expect(text).toMatch(/setu_batch_duration_seconds_count\{stage="match"\} [1-9]/);
  });

  it('streams a run’s progress as Server-Sent Events until it completes', async () => {
    const data = generateRegister({ rows: 400, seed: 1516, encoding: 'cp1252' });
    const run = await createRun(api, operator, encodeCp1252(data.csv), 'dry_run');
    // supertest sends a request only once it is awaited or then()-ed: start it now.
    const stream = api
      .as(operator)
      .get(`/runs/${run.runId}/events`)
      .buffer(true)
      .parse((res, done) => {
        let text = '';
        res.on('data', (chunk: Buffer) => (text += chunk.toString()));
        res.on('end', () => done(null, text));
      })
      .then((res) => res);
    await new Promise((r) => setTimeout(r, 300)); // let the stream subscribe first
    await startRun(api, operator, run.runId);

    const res = await stream;
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    const events = sseEvents(res.body as string);
    expect(events.length).toBeGreaterThan(2);
    expect(events[0].status).toBe('draft');
    expect(events.at(-1)).toMatchObject({ status: 'completed', counts: { total: 400 } });
  }, 60_000);

  it('answers 404 for the events of an unknown run', async () => {
    await api.as(operator).get('/runs/00000000-0000-4000-8000-000000000000/events').expect(404);
  });
});
