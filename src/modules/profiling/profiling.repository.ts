import { Injectable } from '@nestjs/common';
import type { Prisma, Profile } from '@prisma/client';
import { PrismaService } from '../../shared/db/prisma.service';

export type Tx = Prisma.TransactionClient;

@Injectable()
export class ProfilingRepository {
  constructor(private readonly prisma: PrismaService) {}

  transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(work);
  }

  findByFile(sourceFileId: string): Promise<Profile | null> {
    return this.prisma.profile.findUnique({ where: { sourceFileId } });
  }

  async create(tx: Tx, sourceFileId: string, report: object): Promise<void> {
    await tx.profile.create({ data: { sourceFileId, report: report as Prisma.InputJsonObject } });
  }
}
