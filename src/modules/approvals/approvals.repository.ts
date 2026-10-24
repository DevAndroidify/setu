import { Injectable } from '@nestjs/common';
import type { Approval, ApprovalDecision, Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/db/prisma.service';

export type Tx = Prisma.TransactionClient;

@Injectable()
export class ApprovalsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(tx: Tx, runId: string, requestedBy: string, expiresAt: Date): Promise<Approval> {
    return tx.approval.create({ data: { runId, requestedBy, expiresAt } });
  }

  latest(runId: string, tx: Tx | PrismaService = this.prisma): Promise<Approval | null> {
    return tx.approval.findFirst({ where: { runId }, orderBy: { createdAt: 'desc' } });
  }

  /** Records the decision only if nobody decided first; false if someone did. */
  async decide(
    tx: Tx,
    id: string,
    data: { decidedBy: string; decision: ApprovalDecision; reason: string; expiresAt: Date },
  ): Promise<boolean> {
    const { count } = await tx.approval.updateMany({
      where: { id, decision: null },
      data: { ...data, decidedAt: new Date() },
    });
    return count === 1;
  }

  list(runId: string): Promise<Approval[]> {
    return this.prisma.approval.findMany({ where: { runId }, orderBy: { createdAt: 'asc' } });
  }
}
