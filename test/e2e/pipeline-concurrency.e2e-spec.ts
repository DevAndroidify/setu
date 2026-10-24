import { INestApplication, INestApplicationContext } from '@nestjs/common';
import { Pool } from 'pg';
import { encodeCp1252, generateRegister } from '../../tools/generate-legacy-data';
import { apiClient } from '../support/api-client';
import { startApi } from '../support/app';
import { createTestPool } from '../support/db';
import { createRun, startRun, startWorker, waitForRun } from '../support/pipeline';

describe('pipeline under concurrent batches', () => {
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

  // Planted duplicates re-enter people (citizenship number and household) from anywhere
  // earlier in the file, so batches loading at the same time touch each other's rows.
  it('completes every run when batches holding each other’s duplicates load at the same time', async () => {
    const statuses: string[] = [];
    for (let seed = 6001; seed <= 6008; seed++) {
      const register = generateRegister({ rows: 1000, seed, encoding: 'cp1252' });
      const { runId } = await createRun(api, operator, encodeCp1252(register.csv), 'production');
      await startRun(api, operator, runId);
      statuses.push((await waitForRun(pool, runId)).status);
    }
    expect(statuses).toEqual(Array(8).fill('completed'));
  }, 180_000);
});
