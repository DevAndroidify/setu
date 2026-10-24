import { Injectable } from '@nestjs/common';
import type {
  Batch,
  BatchStage,
  Prisma,
  Run,
  RunMode,
  RunStatus,
  StagedStatus,
} from '@prisma/client';
import { PrismaService } from '../../shared/db/prisma.service';

export type Tx = Prisma.TransactionClient;

export type RunCounts = {
  total?: number;
  loaded?: number;
  linked?: number;
  quarantined?: number;
  review?: number;
  valid?: number;
};

/** An earlier row the match stage compares against: same run, or a person already loaded. */
export type MatchCandidateRow = {
  stagedRowId: bigint;
  rawRowId: bigint;
  runId: string;
  status: StagedStatus;
  normalized: unknown;
};

/** Stage transactions read and write up to a batch of rows; give them time. */
const STAGE_TX = { timeout: 60_000, maxWait: 10_000 };

@Injectable()
export class PipelineRepository {
  constructor(private readonly prisma: PrismaService) {}

  transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(work, STAGE_TX);
  }

  // ───────────── runs ─────────────

  createRun(
    tx: Tx,
    data: { sourceFileId: string; mappingId: string; mode: RunMode; createdBy: string },
  ): Promise<Run> {
    return tx.run.create({ data });
  }

  findRun(id: string, tx: Tx | PrismaService = this.prisma): Promise<Run | null> {
    return tx.run.findUnique({ where: { id } });
  }

  /** Moves a run between statuses only if it is in one of `from`; false if it was not. */
  async transition(
    tx: Tx,
    id: string,
    from: RunStatus[],
    to: RunStatus,
    extra: Prisma.RunUncheckedUpdateManyInput = {},
  ): Promise<boolean> {
    const { count } = await tx.run.updateMany({
      where: { id, status: { in: from } },
      data: { status: to, ...extra },
    });
    return count === 1;
  }

  async setCounts(id: string, counts: RunCounts): Promise<void> {
    await this.prisma.run.update({ where: { id }, data: { counts } });
  }

  /** Row counts by staged status, straight from staging (the source of truth). */
  async stagedCounts(runId: string): Promise<Record<StagedStatus, number>> {
    const rows = await this.prisma.$queryRaw<{ status: StagedStatus; n: number }[]>`
      SELECT s.status, count(*)::int AS n
      FROM staging.staged_rows s JOIN staging.raw_rows r ON r.id = s.raw_row_id
      WHERE r.run_id = ${runId}::uuid
      GROUP BY s.status`;
    const counts = { valid: 0, quarantined: 0, duplicate_review: 0, loaded: 0, linked: 0 };
    for (const { status, n } of rows) counts[status] = n;
    return counts;
  }

  /**
   * Serializes one kind of work across the batches of a run until the transaction ends, so
   * each batch sees what the batches before it committed.
   */
  async lockRun(tx: Tx, runId: string, work: 'load'): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${work}:${runId}`}, 0))`;
  }

  // ───────────── batches ─────────────

  /** True while a batch before `seq` has not finished matching: batches match in order. */
  async earlierBatchesUnmatched(tx: Tx, runId: string, seq: number): Promise<boolean> {
    const n = await tx.batch.count({
      where: {
        runId,
        seq: { lt: seq },
        stage: { in: ['extract', 'transform', 'validate', 'match'] },
      },
    });
    return n > 0;
  }

  nextBatch(tx: Tx, runId: string, seq: number): Promise<Batch | null> {
    return tx.batch.findUnique({ where: { runId_seq: { runId, seq: seq + 1 } } });
  }

  /** Creates the batch for (run, seq) once; extracting the same batch again returns it. */
  async upsertBatch(tx: Tx, runId: string, seq: number, rowFrom: number, rowTo: number) {
    return tx.batch.upsert({
      where: { runId_seq: { runId, seq } },
      create: { runId, seq, rowFrom, rowTo },
      update: {},
    });
  }

  /** Locks the batch row for the rest of the transaction, so one stage runs it at a time. */
  async lockBatch(tx: Tx, id: string): Promise<Batch | null> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM control.batches WHERE id = ${id}::uuid FOR UPDATE`;
    return rows.length ? tx.batch.findUnique({ where: { id } }) : null;
  }

  async setStage(tx: Tx, id: string, stage: BatchStage): Promise<void> {
    await tx.batch.update({
      where: { id },
      data: { stage, status: stage === 'done' ? 'completed' : 'pending', error: null },
    });
  }

  /** Marks the batch as being worked on now; the sweeper re-queues batches that go quiet. */
  async heartbeat(id: string): Promise<void> {
    await this.prisma.batch.updateMany({
      where: { id },
      data: { heartbeatAt: new Date(), status: 'running', attempts: { increment: 1 } },
    });
  }

  async failBatch(id: string, error: string): Promise<void> {
    await this.prisma.batch.updateMany({ where: { id }, data: { status: 'failed', error } });
  }

  unfinishedBatches(runId: string): Promise<Batch[]> {
    return this.prisma.batch.findMany({
      where: { runId, stage: { not: 'done' } },
      orderBy: { seq: 'asc' },
    });
  }

  countUnfinishedBatches(runId: string): Promise<number> {
    return this.prisma.batch.count({ where: { runId, stage: { not: 'done' } } });
  }

  /** Batches of running runs that nobody has touched for a while: lost or never queued. */
  staleBatches(staleSeconds: number): Promise<Batch[]> {
    return this.prisma.batch.findMany({
      where: {
        stage: { notIn: ['extract', 'done'] },
        status: { not: 'failed' },
        run: { status: 'running' },
        OR: [
          { heartbeatAt: null },
          { heartbeatAt: { lt: new Date(Date.now() - staleSeconds * 1000) } },
        ],
      },
      take: 500,
    });
  }

  /** Runs that should be extracting: queued, or running but not yet fully extracted. */
  async runsAwaitingExtract(): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM control.runs
      WHERE status IN ('queued', 'running') AND NOT (counts ? 'total')
      LIMIT 500`;
    return rows.map((r) => r.id);
  }

  batchSummary(runId: string) {
    return this.prisma.batch.groupBy({ by: ['stage'], where: { runId }, _count: true });
  }

  // ───────────── staging rows ─────────────

  async insertRawRows(
    tx: Tx,
    rows: {
      runId: string;
      batchId: string;
      rowNo: number;
      raw: Record<string, string>;
      rowHash: string;
    }[],
  ): Promise<void> {
    await tx.rawRow.createMany({ data: rows, skipDuplicates: true });
  }

  rawRowsForBatch(tx: Tx, batchId: string) {
    return tx.rawRow.findMany({ where: { batchId }, orderBy: { rowNo: 'asc' } });
  }

  async insertStagedRows(
    tx: Tx,
    rows: { rawRowId: bigint; normalized: object; warnings: object[]; status: StagedStatus }[],
  ): Promise<void> {
    await tx.stagedRow.createMany({
      data: rows.map((r) => ({
        ...r,
        normalized: r.normalized as Prisma.InputJsonObject,
        warnings: r.warnings as Prisma.InputJsonArray,
      })),
      skipDuplicates: true,
    });
  }

  stagedRowsForBatch(tx: Tx, batchId: string, status?: StagedStatus) {
    return tx.stagedRow.findMany({
      where: { rawRow: { batchId }, ...(status ? { status } : {}) },
      orderBy: { rawRowId: 'asc' },
    });
  }

  /** Every loaded row of a run with what staging said to load. */
  loadedRows(runId: string): Promise<{ rawRowId: bigint; rowNo: number; normalized: unknown }[]> {
    return this.prisma.$queryRaw`
      SELECT r.id AS "rawRowId", r.row_no AS "rowNo", s.normalized
      FROM staging.staged_rows s JOIN staging.raw_rows r ON r.id = s.raw_row_id
      WHERE r.run_id = ${runId}::uuid AND s.status = 'loaded'`;
  }

  batchesNewestFirst(runId: string): Promise<Batch[]> {
    return this.prisma.batch.findMany({ where: { runId }, orderBy: { seq: 'desc' } });
  }

  /** After a rollback, the batch's loaded and linked rows are valid again. */
  async unloadBatch(tx: Tx, batchId: string): Promise<void> {
    await tx.stagedRow.updateMany({
      where: { rawRow: { batchId }, status: { in: ['loaded', 'linked'] } },
      data: { status: 'valid' },
    });
  }

  /**
   * Rows an incoming row may duplicate: in the same block or with the same citizenship number,
   * and either still valid in an earlier-matched batch of this run, or loaded by any run.
   */
  matchCandidates(
    tx: Tx,
    runId: string,
    blockKeys: string[],
    citizenshipNos: string[],
  ): Promise<MatchCandidateRow[]> {
    return tx.$queryRaw`
      SELECT s.id AS "stagedRowId", s.raw_row_id AS "rawRowId", r.run_id AS "runId",
             s.status, s.normalized
      FROM staging.staged_rows s
      JOIN staging.raw_rows r ON r.id = s.raw_row_id
      JOIN control.batches b ON b.id = r.batch_id
      WHERE (s.block_key = ANY(${blockKeys}) OR s.normalized->>'citizenship_no' = ANY(${citizenshipNos}))
        AND (
          (r.run_id = ${runId}::uuid AND s.status = 'valid' AND b.stage IN ('load', 'done'))
          OR s.status = 'loaded'
        )
      ORDER BY s.raw_row_id`;
  }

  async setBlockKeys(tx: Tx, rows: { id: bigint; key: string | null }[]): Promise<void> {
    if (rows.length === 0) return;
    await tx.$executeRaw`
      UPDATE staging.staged_rows s SET block_key = v.key
      FROM (SELECT unnest(${rows.map((r) => r.id)}::bigint[]) AS id,
                   unnest(${rows.map((r) => r.key)}::text[]) AS key) v
      WHERE s.id = v.id`;
  }

  /** Staged rows with their raw row (run, batch, row number), for the review queue. */
  stagedRowsWithRaw(ids: bigint[], tx: Tx | PrismaService = this.prisma) {
    return tx.stagedRow.findMany({ where: { id: { in: ids } }, include: { rawRow: true } });
  }

  /** Staged rows of one run held for duplicate review. */
  async heldRowIds(runId: string): Promise<bigint[]> {
    const rows = await this.prisma.stagedRow.findMany({
      where: { status: 'duplicate_review', rawRow: { runId } },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  async lockStagedRow(tx: Tx, id: bigint): Promise<void> {
    await tx.$queryRaw`SELECT id FROM staging.staged_rows WHERE id = ${id} FOR UPDATE`;
  }

  async setStagedStatus(tx: Tx, ids: bigint[], status: StagedStatus): Promise<void> {
    if (ids.length === 0) return;
    await tx.stagedRow.updateMany({ where: { id: { in: ids } }, data: { status } });
  }
}
