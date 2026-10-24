import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/db/prisma.service';

export type Tx = Prisma.TransactionClient;
export type QuarantineEntry = { stagedRowId: bigint; stage: string; reasons: unknown[] };

@Injectable()
export class QuarantineRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** One entry per (row, stage): a retried stage re-inserting the same entry is ignored. */
  async insertMany(tx: Tx, entries: QuarantineEntry[]): Promise<void> {
    if (entries.length === 0) return;
    await tx.quarantine.createMany({
      data: entries.map((e) => ({ ...e, reasons: e.reasons as Prisma.InputJsonArray })),
      skipDuplicates: true,
    });
  }

  list(filter: { runId?: string; stage?: string }, limit: number, afterId?: bigint) {
    return this.prisma.quarantine.findMany({
      where: {
        resolvedAt: null,
        ...(filter.stage ? { stage: filter.stage } : {}),
        ...(filter.runId ? { stagedRow: { rawRow: { runId: filter.runId } } } : {}),
        ...(afterId ? { id: { gt: afterId } } : {}),
      },
      orderBy: { id: 'asc' },
      take: limit,
      include: { stagedRow: { include: { rawRow: true } } },
    });
  }
}
