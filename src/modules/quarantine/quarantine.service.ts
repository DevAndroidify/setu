import { Injectable, NotFoundException } from '@nestjs/common';
import { QuarantineEntry, QuarantineRepository, Tx } from './quarantine.repository';

@Injectable()
export class QuarantineService {
  constructor(private readonly repo: QuarantineRepository) {}

  /** Records rows that failed a stage, with every reason. Runs in the stage's transaction. */
  record(tx: Tx, entries: QuarantineEntry[]): Promise<void> {
    return this.repo.insertMany(tx, entries);
  }

  find(id: bigint, tx?: Tx) {
    return this.repo.find(id, tx);
  }

  correctedForRun(tx: Tx, runId: string, ids?: bigint[]) {
    return this.repo.correctedForRun(tx, runId, ids);
  }

  setCorrection(tx: Tx, id: bigint, corrected: Record<string, string>, userId: string) {
    return this.repo.setCorrection(tx, id, corrected, userId);
  }

  setReasons(tx: Tx, id: bigint, reasons: unknown[]) {
    return this.repo.setReasons(tx, id, reasons);
  }

  /** Closes entries whose row now passes; they stay in the table as the history of the fix. */
  resolve(tx: Tx, ids: bigint[], userId: string) {
    return this.repo.resolve(tx, ids, userId);
  }

  /** One quarantined row as the list shows it. */
  async get(id: bigint) {
    const q = await this.repo.find(id);
    if (!q) throw new NotFoundException('Quarantined row not found');
    return this.view(q);
  }

  async list(filter: { runId?: string; stage?: string }, limit: number, cursor?: string) {
    const rows = await this.repo.list(filter, limit, cursor ? BigInt(cursor) : undefined);
    const data = rows.map((q) => this.view(q));
    const last = data[data.length - 1];
    return { data, nextCursor: data.length === limit && last ? last.id : null };
  }

  private view(q: NonNullable<Awaited<ReturnType<QuarantineRepository['find']>>>) {
    return {
      id: q.id.toString(),
      runId: q.stagedRow.rawRow.runId,
      rowNo: q.stagedRow.rawRow.rowNo,
      stage: q.stage,
      reasons: q.reasons,
      raw: q.stagedRow.rawRow.raw,
      normalized: q.stagedRow.normalized,
      corrected: q.corrected,
      correctedAt: q.correctedAt,
      resolvedAt: q.resolvedAt,
      createdAt: q.createdAt,
    };
  }
}
