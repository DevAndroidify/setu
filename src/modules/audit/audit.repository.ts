import { Injectable } from '@nestjs/common';
import { AuditEvent, Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/db/prisma.service';
import type { StoredEvent } from './hash-chain';

export type Tx = Prisma.TransactionClient;

export type EventFilter = {
  stream?: string;
  entity?: string;
  entityId?: string;
  action?: string;
};

export const toStored = (row: AuditEvent): StoredEvent => ({
  stream: row.stream,
  seq: Number(row.seq),
  occurredAt: row.occurredAt,
  actorId: row.actorId,
  action: row.action,
  entity: row.entity,
  entityId: row.entityId,
  payload: row.payload,
  reason: row.reason,
  prevHash: row.prevHash,
  hash: row.hash,
});

@Injectable()
export class AuditRepository {
  constructor(private readonly prisma: PrismaService) {}

  transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(work);
  }

  /**
   * Serializes appends to one stream until the transaction ends. Only this stream waits, so
   * busy streams do not slow each other down.
   */
  async lockStream(tx: Tx, stream: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${stream}, 0))`;
  }

  async head(tx: Tx, stream: string): Promise<{ seq: number; hash: string } | null> {
    const last = await tx.auditEvent.findFirst({
      where: { stream },
      orderBy: { seq: 'desc' },
      select: { seq: true, hash: true },
    });
    return last ? { seq: Number(last.seq), hash: last.hash } : null;
  }

  async insert(tx: Tx, event: StoredEvent): Promise<void> {
    await tx.auditEvent.create({
      data: {
        ...event,
        seq: BigInt(event.seq),
        payload: event.payload as Prisma.InputJsonValue,
      },
    });
  }

  async streams(): Promise<string[]> {
    const rows = await this.prisma.auditEvent.groupBy({
      by: ['stream'],
      orderBy: { stream: 'asc' },
    });
    return rows.map((r) => r.stream);
  }

  /** One page of a stream in seq order, for walking the chain without loading it all. */
  async page(stream: string, afterSeq: number, limit: number): Promise<StoredEvent[]> {
    const rows = await this.prisma.auditEvent.findMany({
      where: { stream, seq: { gt: BigInt(afterSeq) } },
      orderBy: { seq: 'asc' },
      take: limit,
    });
    return rows.map(toStored);
  }

  /** Newest first; the cursor is the (stream, seq) of the last event on the previous page. */
  async list(
    filter: EventFilter,
    limit: number,
    cursor?: { stream: string; seq: number },
  ): Promise<StoredEvent[]> {
    const rows = await this.prisma.auditEvent.findMany({
      where: filter,
      orderBy: [{ occurredAt: 'desc' }, { stream: 'asc' }, { seq: 'desc' }],
      take: limit,
      ...(cursor
        ? { cursor: { stream_seq: { stream: cursor.stream, seq: BigInt(cursor.seq) } }, skip: 1 }
        : {}),
    });
    return rows.map(toStored);
  }
}
