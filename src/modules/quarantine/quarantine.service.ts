import { Injectable } from '@nestjs/common';
import { QuarantineEntry, QuarantineRepository, Tx } from './quarantine.repository';

@Injectable()
export class QuarantineService {
  constructor(private readonly repo: QuarantineRepository) {}

  /** Records rows that failed a stage, with every reason. Runs in the stage's transaction. */
  record(tx: Tx, entries: QuarantineEntry[]): Promise<void> {
    return this.repo.insertMany(tx, entries);
  }

  async list(filter: { runId?: string; stage?: string }, limit: number, cursor?: string) {
    const rows = await this.repo.list(filter, limit, cursor ? BigInt(cursor) : undefined);
    const data = rows.map((q) => ({
      id: q.id.toString(),
      runId: q.stagedRow.rawRow.runId,
      rowNo: q.stagedRow.rawRow.rowNo,
      stage: q.stage,
      reasons: q.reasons,
      raw: q.stagedRow.rawRow.raw,
      normalized: q.stagedRow.normalized,
      createdAt: q.createdAt,
    }));
    const last = data[data.length - 1];
    return { data, nextCursor: data.length === limit && last ? last.id : null };
  }
}
