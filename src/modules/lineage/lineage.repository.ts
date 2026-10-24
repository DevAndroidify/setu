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
}
