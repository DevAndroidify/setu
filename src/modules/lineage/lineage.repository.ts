import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/db/prisma.service';

export type LineageLink = {
  targetTable: string;
  targetId: string;
  rawRowId: bigint;
  mappingId: string;
  runId: string;
  batchId: string;
};

@Injectable()
export class LineageRepository {
  constructor(private readonly prisma: PrismaService) {}

  async insertMany(tx: Prisma.TransactionClient, links: LineageLink[]): Promise<void> {
    if (links.length === 0) return;
    await tx.lineage.createMany({ data: links, skipDuplicates: true });
  }

  countForRun(runId: string): Promise<number> {
    return this.prisma.lineage.count({ where: { runId } });
  }

  forRun(runId: string): Promise<{ rawRowId: bigint; targetId: string }[]> {
    return this.prisma.lineage.findMany({
      where: { runId, targetTable: 'persons' },
      select: { rawRowId: true, targetId: true },
    });
  }

  /** Deletes a batch's links and returns the target ids they pointed to. */
  async deleteForBatch(tx: Prisma.TransactionClient, batchId: string): Promise<string[]> {
    const links = await tx.lineage.findMany({
      where: { batchId, targetTable: 'persons' },
      select: { targetId: true },
    });
    await tx.lineage.deleteMany({ where: { batchId } });
    return links.map((l) => l.targetId);
  }

  /** True if another run has linked to any record this run created. */
  async linkedFromOtherRuns(runId: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<{ linked: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM target.lineage other
        WHERE other.run_id <> ${runId}::uuid
          AND other.target_id IN (SELECT target_id FROM target.lineage WHERE run_id = ${runId}::uuid)
      ) AS linked`;
    return rows[0]?.linked ?? false;
  }
}
