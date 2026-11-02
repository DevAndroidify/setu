import { Injectable } from '@nestjs/common';
import type { Prisma, Source, SourceFile, SourceKind } from '@prisma/client';
import { PrismaService } from '../../shared/db/prisma.service';

export type Tx = Prisma.TransactionClient;

@Injectable()
export class SourcesRepository {
  constructor(private readonly prisma: PrismaService) {}

  transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(work);
  }

  createSource(
    tx: Tx,
    data: { name: string; kind: SourceKind; agency: string; createdBy: string },
  ): Promise<Source> {
    return tx.source.create({ data });
  }

  /** Newest first; `after` is the id of the last source of the previous page. */
  listSources(limit: number, after?: string) {
    return this.prisma.source.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      ...(after ? { cursor: { id: after }, skip: 1 } : {}),
      include: { _count: { select: { files: true } } },
    });
  }

  /** A source's files, newest first, with whether their profile is done. */
  listFiles(sourceId: string) {
    return this.prisma.sourceFile.findMany({
      where: { sourceId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { profile: { select: { report: true } } },
    });
  }

  findSourceWithFileCount(id: string) {
    return this.prisma.source.findUnique({
      where: { id },
      include: { _count: { select: { files: true } } },
    });
  }

  findSource(id: string): Promise<Source | null> {
    return this.prisma.source.findUnique({ where: { id } });
  }

  findFileBySha256(sha256: string): Promise<SourceFile | null> {
    return this.prisma.sourceFile.findUnique({ where: { sha256 } });
  }

  findFile(id: string): Promise<SourceFile | null> {
    return this.prisma.sourceFile.findUnique({ where: { id } });
  }

  createFile(
    tx: Tx,
    data: {
      sourceId: string;
      filename: string;
      objectKey: string;
      sha256: string;
      sizeBytes: number;
      encoding: string | null;
      uploadedBy: string;
    },
  ): Promise<SourceFile> {
    return tx.sourceFile.create({ data: { ...data, sizeBytes: BigInt(data.sizeBytes) } });
  }

  async setRowCount(tx: Tx, id: string, rowCount: number): Promise<void> {
    await tx.sourceFile.update({ where: { id }, data: { rowCount } });
  }
}
