import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Pool } from 'pg';
import { createTestPool, insertUser, uniqueStream } from '../support/db';

describe('database schema', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = createTestPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  async function insertAuditEvent(stream: string, seq: number): Promise<void> {
    await pool.query(
      `INSERT INTO audit.events (stream, seq, occurred_at, action, entity, payload, prev_hash, hash)
       VALUES ($1, $2, now(), 'test.action', 'test', '{}', 'prev', 'hash')`,
      [stream, seq],
    );
  }

  describe('audit.events', () => {
    it('accepts new events', async () => {
      const stream = uniqueStream();
      await insertAuditEvent(stream, 1);
      const { rowCount } = await pool.query('SELECT 1 FROM audit.events WHERE stream = $1', [
        stream,
      ]);
      expect(rowCount).toBe(1);
    });

    it('refuses to UPDATE an event, even for the table owner', async () => {
      const stream = uniqueStream();
      await insertAuditEvent(stream, 1);
      await expect(
        pool.query(`UPDATE audit.events SET action = 'tampered' WHERE stream = $1`, [stream]),
      ).rejects.toThrow('audit.events is append-only');
    });

    it('refuses to DELETE an event', async () => {
      const stream = uniqueStream();
      await insertAuditEvent(stream, 1);
      await expect(
        pool.query('DELETE FROM audit.events WHERE stream = $1', [stream]),
      ).rejects.toThrow('audit.events is append-only');
    });

    it('refuses to TRUNCATE the events table', async () => {
      await expect(pool.query('TRUNCATE audit.events')).rejects.toThrow(
        'audit.events is append-only',
      );
    });

    it('refuses two events with the same sequence number in one stream', async () => {
      const stream = uniqueStream();
      await insertAuditEvent(stream, 1);
      await expect(insertAuditEvent(stream, 1)).rejects.toThrow(/duplicate key/);
    });
  });

  it('refuses an approval decided by the user who requested it', async () => {
    const operator = await insertUser(pool);
    const source = randomUUID();
    const file = randomUUID();
    const mapping = randomUUID();
    const run = randomUUID();
    await pool.query(
      `INSERT INTO control.sources (id, name, kind, agency, created_by) VALUES ($1, 'src', 'csv', 'agency', $2)`,
      [source, operator],
    );
    await pool.query(
      `INSERT INTO control.source_files (id, source_id, filename, object_key, sha256, size_bytes, uploaded_by)
       VALUES ($1, $2, 'f.csv', 'key', $3, 10, $4)`,
      [file, source, createHash('sha256').update(randomUUID()).digest('hex'), operator],
    );
    await pool.query(
      `INSERT INTO control.mappings (id, source_id, version, spec, created_by) VALUES ($1, $2, 1, '{}', $3)`,
      [mapping, source, operator],
    );
    await pool.query(
      `INSERT INTO control.runs (id, source_file_id, mapping_id, mode, created_by)
       VALUES ($1, $2, $3, 'production', $4)`,
      [run, file, mapping, operator],
    );

    await expect(
      pool.query(
        `INSERT INTO control.approvals (run_id, requested_by, decided_by, decision, decided_at, expires_at)
         VALUES ($1, $2, $2, 'approved', now(), now() + interval '1 day')`,
        [run, operator],
      ),
    ).rejects.toThrow(/approvals_maker_is_not_checker/);
  });

  it('refuses a second source file with the same sha256', async () => {
    const operator = await insertUser(pool);
    const source = randomUUID();
    const sha256 = createHash('sha256').update(randomUUID()).digest('hex');
    await pool.query(
      `INSERT INTO control.sources (id, name, kind, agency, created_by) VALUES ($1, 'src', 'csv', 'agency', $2)`,
      [source, operator],
    );
    const insertFile = () =>
      pool.query(
        `INSERT INTO control.source_files (source_id, filename, object_key, sha256, size_bytes, uploaded_by)
         VALUES ($1, 'f.csv', 'key', $2, 10, $3)`,
        [source, sha256, operator],
      );
    await insertFile();
    await expect(insertFile()).rejects.toThrow(/duplicate key/);
  });

  it('allows many persons without a citizenship number but not two with the same one', async () => {
    const insertPerson = (citizenshipNo: string | null) =>
      pool.query(
        `INSERT INTO target.persons (name_ne, name_en, citizenship_no) VALUES ('राम', 'Ram', $1)`,
        [citizenshipNo],
      );
    await insertPerson(null);
    await insertPerson(null);
    const number = `99-00-00-${randomUUID().slice(0, 5)}`;
    await insertPerson(number);
    await expect(insertPerson(number)).rejects.toThrow(/duplicate key/);
  });

  it('keeps the Prisma schema and the migrations in sync', async () => {
    await pool.query('CREATE DATABASE drift_shadow');
    const shadow = new URL(process.env.DATABASE_URL!);
    shadow.pathname = '/drift_shadow';
    const prisma = join(__dirname, '../../node_modules/.bin/prisma');
    // --exit-code: 0 means no difference, 2 means the schema needs a new migration.
    expect(() =>
      execFileSync(
        prisma,
        [
          'migrate',
          'diff',
          '--from-migrations',
          'prisma/migrations',
          '--to-schema-datamodel',
          'prisma/schema.prisma',
          '--shadow-database-url',
          shadow.toString(),
          '--exit-code',
        ],
        { stdio: 'pipe' },
      ),
    ).not.toThrow();
  });
});
