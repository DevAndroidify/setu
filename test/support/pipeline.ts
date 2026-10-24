import { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { Pool } from 'pg';
import { WorkerModule } from '../../apps/worker/worker.module';
import spec from '../fixtures/mappings/household-register.v1.json';
import { apiClient } from './api-client';

/** Starts the worker app in this process (all queue processors and the sweeper). */
export async function startWorker(): Promise<INestApplicationContext> {
  const worker = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  worker.useLogger(worker.get(Logger));
  return worker;
}

type Api = ReturnType<typeof apiClient>;

/** Uploads a file, saves the household register mapping and creates a run for it. */
export async function createRun(
  api: Api,
  token: string,
  bytes: Buffer,
  mode: 'dry_run' | 'production',
): Promise<{ runId: string; fileId: string; mappingId: string }> {
  const { sourceId, fileId } = await api.uploadFile(token, bytes);
  const mapping = await api.as(token).post(`/sources/${sourceId}/mappings`, spec).expect(201);
  const run = await api
    .as(token)
    .post('/runs', { sourceFileId: fileId, mappingId: mapping.body.id, mode })
    .expect(201);
  return { runId: run.body.id, fileId, mappingId: mapping.body.id };
}

/**
 * Starts a run the way a real team would: a production run is first submitted by the
 * operator and approved by a different user with the approver role.
 */
export async function startRun(api: Api, operatorToken: string, runId: string): Promise<void> {
  const run = await api.as(operatorToken).get(`/runs/${runId}`).expect(200);
  if (run.body.mode === 'production') {
    await api.as(operatorToken).post(`/runs/${runId}/submit`).expect(200);
    const approver = (await api.login('approver')).token;
    await api
      .as(approver)
      .post(`/runs/${runId}/approve`, {
        decision: 'approved',
        reason: 'Checked the dry run report',
      })
      .expect(200);
  }
  await api.as(operatorToken).post(`/runs/${runId}/start`).expect(202);
}

/** Polls the run until it reaches one of the given statuses. */
export async function waitForRun(
  pool: Pool,
  runId: string,
  statuses: string[] = ['completed', 'failed'],
  timeoutMs = 60_000,
): Promise<{ status: string; counts: Record<string, number> }> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { rows } = await pool.query('SELECT status, counts FROM control.runs WHERE id = $1', [
      runId,
    ]);
    if (statuses.includes(rows[0].status)) return rows[0];
    if (Date.now() > deadline) {
      throw new Error(`run ${runId} still ${rows[0].status} after ${timeoutMs} ms`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

export const count = async (pool: Pool, sql: string, params: unknown[]): Promise<number> =>
  (await pool.query<{ n: number }>(sql, params)).rows[0]!.n;
