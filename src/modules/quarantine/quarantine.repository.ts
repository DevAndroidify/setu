import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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

  /** An entry with its staged and raw row; `tx` locks it for the rest of the transaction. */
  async find(id: bigint, tx?: Tx) {
    if (tx) await tx.$queryRaw`SELECT id FROM staging.quarantine WHERE id = ${id} FOR UPDATE`;
    return (tx ?? this.prisma).quarantine.findUnique({
      where: { id },
      include: { stagedRow: { include: { rawRow: true } } },
    });
  }

  /** Open entries of a run that have a correction, optionally only the given ones. */
  correctedForRun(tx: Tx, runId: string, ids?: bigint[]) {
    return tx.quarantine.findMany({
      where: {
        resolvedAt: null,
        corrected: { not: Prisma.AnyNull },
        stagedRow: { rawRow: { runId } },
        ...(ids ? { id: { in: ids } } : {}),
      },
      orderBy: { id: 'asc' },
      include: { stagedRow: { include: { rawRow: true } } },
    });
  }

  async setCorrection(tx: Tx, id: bigint, corrected: Record<string, string>, userId: string) {
    await tx.quarantine.update({
      where: { id },
      data: { corrected, correctedBy: userId, correctedAt: new Date() },
    });
  }

  async setReasons(tx: Tx, id: bigint, reasons: unknown[]) {
    await tx.quarantine.update({
      where: { id },
      data: { reasons: reasons as Prisma.InputJsonArray },
    });
  }

  async resolve(tx: Tx, ids: bigint[], userId: string) {
    if (ids.length === 0) return;
    await tx.quarantine.updateMany({
      where: { id: { in: ids } },
      data: { resolvedBy: userId, resolvedAt: new Date() },
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
