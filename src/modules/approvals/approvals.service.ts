import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import type { Approval, ApprovalDecision } from '@prisma/client';
import { ApprovalsRepository, Tx } from './approvals.repository';

/** A request must be decided, and an approval used, within this time. */
export const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Maker-checker records for production runs. Pure bookkeeping: the pipeline moves the run;
 * this module decides whether a decision is allowed and keeps who decided what, and why.
 */
@Injectable()
export class ApprovalsService {
  constructor(private readonly repo: ApprovalsRepository) {}

  request(tx: Tx, runId: string, requestedBy: string): Promise<Approval> {
    return this.repo.create(tx, runId, requestedBy, new Date(Date.now() + APPROVAL_TTL_MS));
  }

  /**
   * Checks the pending request can be decided by this user. The maker (whoever created or
   * submitted the run) can never be the checker, whatever their role is now.
   */
  async pendingFor(
    runId: string,
    deciderId: string,
    makers: string[],
    tx: Tx,
  ): Promise<Approval | 'expired'> {
    const pending = await this.repo.latest(runId, tx);
    if (!pending || pending.decision)
      throw new ConflictException('The run has no pending approval request');
    if ([pending.requestedBy, ...makers].includes(deciderId)) {
      throw new ForbiddenException('You cannot approve a run you created or submitted');
    }
    return pending.expiresAt <= new Date() ? 'expired' : pending;
  }

  async decide(
    tx: Tx,
    approval: Approval,
    decidedBy: string,
    decision: ApprovalDecision,
    reason: string,
  ): Promise<void> {
    // An approval is then valid for 24 hours to start the run.
    const expiresAt =
      decision === 'approved' ? new Date(Date.now() + APPROVAL_TTL_MS) : approval.expiresAt;
    if (!(await this.repo.decide(tx, approval.id, { decidedBy, decision, reason, expiresAt }))) {
      throw new ConflictException('Someone else decided this request first');
    }
  }

  /** The approval a production run may start under, or why it may not. */
  async usableApproval(runId: string): Promise<Approval | 'missing' | 'expired'> {
    const latest = await this.repo.latest(runId);
    if (!latest || latest.decision !== 'approved') return 'missing';
    return latest.expiresAt <= new Date() ? 'expired' : latest;
  }

  history(runId: string): Promise<Approval[]> {
    return this.repo.list(runId);
  }
}
