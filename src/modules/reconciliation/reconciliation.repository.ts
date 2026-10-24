import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/db/prisma.service';
import type { ReconciliationReport } from './reconcile';

@Injectable()
export class ReconciliationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async save(
    tx: Prisma.TransactionClient,
    runId: string,
    report: ReconciliationReport,
  ): Promise<void> {
    const data = report as unknown as Prisma.InputJsonObject;
    await tx.reconciliationReport.upsert({
      where: { runId },
      create: { runId, report: data },
      update: { report: data },
    });
  }

  async find(runId: string): Promise<ReconciliationReport | null> {
    const row = await this.prisma.reconciliationReport.findUnique({ where: { runId } });
    return row ? (row.report as unknown as ReconciliationReport) : null;
  }
}
