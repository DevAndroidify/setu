import { INestApplication, INestApplicationContext } from '@nestjs/common';
import { Pool } from 'pg';
import { encodeCp1252, generateRegister } from '../../tools/generate-legacy-data';
import { toSqlDump, toXlsx, toXml } from '../../tools/legacy-formats';
import { apiClient } from '../support/api-client';
import { startApi } from '../support/app';
import { createTestPool } from '../support/db';
import { createRun, startRun, startWorker, waitForRun } from '../support/pipeline';

const register = generateRegister({ rows: 500, seed: 2525, encoding: 'cp1252' });

/** The same register in every format Setu reads besides CSV. */
const FORMATS: { kind: string; bytes: () => Promise<Buffer> }[] = [
  { kind: 'excel', bytes: () => toXlsx(register) },
  { kind: 'xml', bytes: async () => encodeCp1252(toXml(register, 'windows-1252')) },
  { kind: 'sql', bytes: async () => encodeCp1252(toSqlDump(register)) },
];

describe('legacy file formats', () => {
  let app: INestApplication;
  let worker: INestApplicationContext;
  let pool: Pool;
  let api: ReturnType<typeof apiClient>;
  let operator: string;
  let csvCounts: Record<string, number>;

  const dryRun = async (bytes: Buffer, kind: string) => {
    const { runId, fileId } = await createRun(api, operator, bytes, 'dry_run', kind);
    await startRun(api, operator, runId);
    const run = await waitForRun(pool, runId);
    expect(run.status).toBe('completed');
    return { counts: run.counts, fileId };
  };

  const createSource = async (kind: string) =>
    (
      await api
        .as(operator)
        .post('/sources', { name: 'Register', kind, agency: 'Synthetic' })
        .expect(201)
    ).body.id as string;

  beforeAll(async () => {
    app = await startApi();
    worker = await startWorker();
    pool = createTestPool();
    api = apiClient(app, pool);
    operator = (await api.login('operator')).token;
    csvCounts = (await dryRun(encodeCp1252(register.csv), 'csv')).counts;
  });

  afterAll(async () => {
    await worker.close();
    await app.close();
    await pool.end();
  });

  it.each(FORMATS)(
    'reads a $kind export of the register exactly like its CSV: same profile rows, same dry-run counts',
    async ({ kind, bytes }) => {
      const { counts, fileId } = await dryRun(await bytes(), kind);
      expect(counts).toEqual(csvCounts);
      // Profiling runs as its own job; wait for its report.
      let profile = null;
      for (let i = 0; i < 100 && !profile; i++) {
        const res = await api.as(operator).get(`/files/${fileId}/profile`);
        if (res.status === 200) profile = res.body;
        else await new Promise((r) => setTimeout(r, 200));
      }
      expect(profile).toMatchObject({ status: 'ok', rowCount: 500 });
    },
  );

  it('rejects an old .xls workbook with a message to save it again', async () => {
    const sourceId = await createSource('excel');
    const ole2 = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
    const res = await api
      .as(operator)
      .upload(`/sources/${sourceId}/files`, ole2, 'old.xls')
      .expect(415);
    expect(res.body.detail).toMatch(/save the file as \.xlsx or CSV/);
  });

  it('rejects an XML file that declares an encoding Setu cannot read', async () => {
    const sourceId = await createSource('xml');
    const bytes = Buffer.from('<?xml version="1.0" encoding="Shift_JIS"?><rows/>');
    const res = await api.as(operator).upload(`/sources/${sourceId}/files`, bytes).expect(415);
    expect(res.body.detail).toMatch(/UTF-8 or Windows-1252/);
  });

  it('saves a failed profile for a SQL dump with rows of two tables', async () => {
    const { fileId } = await api.uploadFile(
      operator,
      Buffer.from('INSERT INTO a (x) VALUES (1);\nINSERT INTO b (x) VALUES (2);\n'),
      'sql',
      'two-tables.sql',
    );
    let profile = null;
    for (let i = 0; i < 100 && !profile; i++) {
      const res = await api.as(operator).get(`/files/${fileId}/profile`);
      if (res.status === 200) profile = res.body;
      else await new Promise((r) => setTimeout(r, 200));
    }
    expect(profile).toMatchObject({
      status: 'failed',
      error: expect.stringMatching(/one table per file/),
    });
  });

  it('rejects a text file uploaded to an Excel source', async () => {
    const sourceId = await createSource('excel');
    await api
      .as(operator)
      .upload(`/sources/${sourceId}/files`, Buffer.from('A,B\r\n1,2\r\n'), 'register.xlsx')
      .expect(415);
  });
});
