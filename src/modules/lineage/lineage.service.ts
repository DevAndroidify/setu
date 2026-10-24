import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { LineageLink, LineageRepository } from './lineage.repository';

export type { LineageLink };

/** Links every target row to the source row, mapping version, run and batch it came from. */
@Injectable()
export class LineageService {
  constructor(private readonly repo: LineageRepository) {}

  /** Runs in the load transaction, so a person never exists without its lineage. */
  record(tx: Prisma.TransactionClient, links: LineageLink[]): Promise<void> {
    return this.repo.insertMany(tx, links);
  }

  countForRun(runId: string): Promise<number> {
    return this.repo.countForRun(runId);
  }

  /** raw row id -> person id, for every person the run loaded. */
  async personsForRun(runId: string): Promise<Map<bigint, string>> {
    const links = await this.repo.forRun(runId);
    return new Map(links.map((l) => [l.rawRowId, l.targetId]));
  }

  /** raw row id -> the person each given row produced or was linked to. */
  async personsForRawRows(rawRowIds: bigint[]): Promise<Map<bigint, string>> {
    const links = await this.repo.forRawRows(rawRowIds);
    return new Map(links.map((l) => [l.rawRowId, l.targetId]));
  }

  /** Every source row behind a person: the one that created it and any linked to it. */
  async forPerson(personId: string) {
    const links = await this.repo.forTarget('persons', personId);
    if (links.length === 0) throw new NotFoundException('No lineage for this person');
    return links.map((l) => ({
      rawRowId: l.rawRowId.toString(),
      runId: l.runId,
      mappingId: l.mappingId,
      batchId: l.batchId,
    }));
  }

  deleteForBatch(tx: Prisma.TransactionClient, batchId: string): Promise<string[]> {
    return this.repo.deleteForBatch(tx, batchId);
  }

  /** True if another run has linked to one of these records, which the run created. */
  linkedFromOtherRuns(runId: string, createdIds: string[]): Promise<boolean> {
    return this.repo.linkedFromOtherRuns(runId, createdIds);
  }
}
