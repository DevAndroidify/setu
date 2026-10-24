import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { buildReport, ReconcileInput, ReconciliationReport, reportToCsv } from './reconcile';
import { ReconciliationRepository } from './reconciliation.repository';

@Injectable()
export class ReconciliationService {
  constructor(private readonly repo: ReconciliationRepository) {}

  build(input: ReconcileInput): ReconciliationReport {
    return buildReport(input);
  }

  /** Saved in the transaction that completes the run, so a completed run always has one. */
  save(tx: Prisma.TransactionClient, runId: string, report: ReconciliationReport): Promise<void> {
    return this.repo.save(tx, runId, report);
  }

  async get(runId: string): Promise<ReconciliationReport> {
    const report = await this.repo.find(runId);
    if (!report) throw new NotFoundException('No reconciliation report: the run has not completed');
    return report;
  }

  async csv(runId: string): Promise<string> {
    return reportToCsv(await this.get(runId));
  }
}
