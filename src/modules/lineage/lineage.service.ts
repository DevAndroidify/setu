import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { LineageLink, LineageRepository } from './lineage.repository';

export type { LineageLink };

/** Links every target row to the source row, mapping version, run and batch it came from. */
@Injectable()
export class LineageService {
  constructor(private readonly repo: LineageRepository) {}

  /** Runs in the load transaction, so a person never exists without its lineage. */
  record(tx: Prisma.TransactionClient, links: LineageLink[]): Promise<void> {
    return this.repo.insertMany(tx, links);
  }

  countForRun(runId: string): Promise<number> {
    return this.repo.countForRun(runId);
  }
}
