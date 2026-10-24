import { Injectable } from '@nestjs/common';
import type { MatchCandidate, MatchDecision, Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/db/prisma.service';

export type Tx = Prisma.TransactionClient;

export type NewCandidate = {
  rowA: bigint;
  rowB: bigint;
  score: number;
  features: object;
  decision: MatchDecision;
};

@Injectable()
export class MatchingRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** One candidate per pair: a retried match stage re-inserting it is ignored. */
  async insertMany(tx: Tx, candidates: NewCandidate[]): Promise<void> {
    if (candidates.length === 0) return;
    await tx.matchCandidate.createMany({
      data: candidates.map((c) => ({ ...c, features: c.features as Prisma.InputJsonObject })),
      skipDuplicates: true,
    });
  }

  /** The linked candidate of each given row (row_a). */
  linksFor(tx: Tx, rowIds: bigint[]): Promise<MatchCandidate[]> {
    if (rowIds.length === 0) return Promise.resolve([]);
    return tx.matchCandidate.findMany({ where: { rowA: { in: rowIds }, decision: 'link' } });
  }

  pending(limit: number, afterId?: bigint, rowIds?: bigint[]): Promise<MatchCandidate[]> {
    return this.prisma.matchCandidate.findMany({
      where: {
        decision: 'pending',
        ...(afterId ? { id: { gt: afterId } } : {}),
        ...(rowIds ? { rowA: { in: rowIds } } : {}),
      },
      orderBy: { id: 'asc' },
      take: limit,
    });
  }

  /** Locks a pending candidate for the rest of the transaction; null if it is not pending. */
  async lockPending(tx: Tx, id: bigint): Promise<MatchCandidate | null> {
    const rows = await tx.$queryRaw<{ id: bigint }[]>`
      SELECT id FROM staging.match_candidates
      WHERE id = ${id} AND decision = 'pending' FOR UPDATE`;
    return rows.length ? tx.matchCandidate.findUnique({ where: { id } }) : null;
  }

  async decide(tx: Tx, id: bigint, decision: MatchDecision, decidedBy: string): Promise<void> {
    await tx.matchCandidate.update({
      where: { id },
      data: { decision, decidedBy, decidedAt: new Date() },
    });
  }
}
