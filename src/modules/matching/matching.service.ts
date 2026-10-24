import { Injectable } from '@nestjs/common';
import type { MatchCandidate, MatchDecision } from '@prisma/client';
import { MatchingRepository, NewCandidate, Tx } from './matching.repository';

/** Match candidates and their decisions. The scoring itself is pure code in score.ts. */
@Injectable()
export class MatchingService {
  constructor(private readonly repo: MatchingRepository) {}

  record(tx: Tx, candidates: NewCandidate[]): Promise<void> {
    return this.repo.insertMany(tx, candidates);
  }

  /** staged row id -> the person it was linked to. */
  async linkedPersons(tx: Tx, rowIds: bigint[]): Promise<Map<bigint, string>> {
    const links = await this.repo.linksFor(tx, rowIds);
    return new Map(links.map((l) => [l.rowA, (l.features as { personId: string }).personId]));
  }

  pending(limit: number, afterId?: bigint, rowIds?: bigint[]): Promise<MatchCandidate[]> {
    return this.repo.pending(limit, afterId, rowIds);
  }

  lockPending(tx: Tx, id: bigint): Promise<MatchCandidate | null> {
    return this.repo.lockPending(tx, id);
  }

  decide(tx: Tx, id: bigint, decision: MatchDecision, decidedBy: string): Promise<void> {
    return this.repo.decide(tx, id, decision, decidedBy);
  }
}
