import { Injectable } from '@nestjs/common';
import type { Mapping, Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/db/prisma.service';
import type { MappingSpec } from './mapping-spec';

export type Tx = Prisma.TransactionClient;

@Injectable()
export class MappingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(work);
  }

  /**
   * Saves the next version for a source. Locking the source row makes concurrent saves take
   * turns, so versions stay 1, 2, 3 ... without gaps or collisions.
   */
  async createNextVersion(
    tx: Tx,
    sourceId: string,
    spec: MappingSpec,
    createdBy: string,
  ): Promise<Mapping> {
    await tx.$executeRaw`SELECT 1 FROM control.sources WHERE id = ${sourceId}::uuid FOR UPDATE`;
    const latest = await tx.mapping.findFirst({
      where: { sourceId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    return tx.mapping.create({
      data: {
        sourceId,
        version: (latest?.version ?? 0) + 1,
        spec: spec as unknown as Prisma.InputJsonObject,
        createdBy,
      },
    });
  }

  find(id: string): Promise<Mapping | null> {
    return this.prisma.mapping.findUnique({ where: { id } });
  }

  listForSource(sourceId: string): Promise<Mapping[]> {
    return this.prisma.mapping.findMany({ where: { sourceId }, orderBy: { version: 'desc' } });
  }
}
