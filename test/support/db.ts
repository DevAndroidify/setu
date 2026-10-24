import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { hashPassword } from '../../src/modules/auth/password';

export function createTestPool(): Pool {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set; run through the jest global setup');
  return new Pool({ connectionString: url, max: 4 });
}

/** Inserts a synthetic user and returns its id. Emails are unique per call. */
export async function insertUser(pool: Pool, role = 'operator'): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO control.users (id, email, password_hash, role)
     VALUES ($1, $2, 'not-a-real-hash', $3) RETURNING id`,
    [randomUUID(), `${role}-${randomUUID()}@setu.test`, role],
  );
  return rows[0]!.id;
}

/** Inserts a user who can log in with the given password; returns its id and email. */
export async function insertLoginUser(
  pool: Pool,
  role: string,
  password: string,
): Promise<{ id: string; email: string }> {
  const email = `${role}-${randomUUID()}@setu.test`;
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO control.users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id`,
    [email, await hashPassword(password), role],
  );
  return { id: rows[0]!.id, email };
}

/** A unique stream name, so tests never collide in the append-only audit tables. */
export const uniqueStream = (): string => `test-${randomUUID()}`;
