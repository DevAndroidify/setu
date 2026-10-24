/**
 * Shows that the audit trail is tamper-evident: edits one stored event the way a database owner
 * could (temporarily disabling the append-only trigger), then tells you how to see verify fail.
 *
 * The append-only trigger stops mistakes and the application role; only an owner can bypass it,
 * and the hash chain is what makes that bypass detectable. For local demos only.
 *
 * Usage: npm run tamper-demo -- [--stream global] [--seq 1]
 */
import { parseArgs } from 'node:util';
import { Client } from 'pg';
import { z } from 'zod';

export async function tamperWithEvent(
  client: Client,
  stream: string,
  seq?: number,
): Promise<{ stream: string; seq: number }> {
  await client.query('BEGIN');
  try {
    const { rows } = await client.query<{ seq: string }>(
      `SELECT seq FROM audit.events WHERE stream = $1 AND ($2::bigint IS NULL OR seq = $2)
       ORDER BY seq LIMIT 1`,
      [stream, seq ?? null],
    );
    const target = rows[0];
    if (!target) throw new Error(`no audit event found in stream "${stream}"`);
    await client.query('ALTER TABLE audit.events DISABLE TRIGGER events_no_update_delete');
    await client.query(
      `UPDATE audit.events SET payload = payload || '{"tampered": true}' WHERE stream = $1 AND seq = $2`,
      [stream, target.seq],
    );
    await client.query('ALTER TABLE audit.events ENABLE TRIGGER events_no_update_delete');
    await client.query('COMMIT');
    return { stream, seq: Number(target.seq) };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { stream: { type: 'string', default: 'global' }, seq: { type: 'string' } },
  });
  const args = z
    .object({ stream: z.string().min(1), seq: z.coerce.number().int().min(1).optional() })
    .parse(values);
  const env = z.object({ DATABASE_URL: z.string().url() }).parse(process.env);

  const client = new Client({ connectionString: env.DATABASE_URL });
  await client.connect();
  try {
    const { stream, seq } = await tamperWithEvent(client, args.stream, args.seq);
    console.log(`Modified audit event ${stream}#${seq}. Now call, as an auditor:`);
    console.log(`  GET /api/v1/audit/verify?stream=${encodeURIComponent(stream)}`);
    console.log(`It should report firstBroken.seq = ${seq}.`);
  } finally {
    await client.end();
  }
}

if (require.main === module) void main();
