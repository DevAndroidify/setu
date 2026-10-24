import { Injectable } from '@nestjs/common';
import { AuditRepository, EventFilter, Tx } from './audit.repository';
import { ChainBreak, ChainVerifier, GENESIS_HASH, hashEvent, StoredEvent } from './hash-chain';

/** Stream for events not tied to a run: logins, user changes. */
export const GLOBAL_STREAM = 'global';

export type AuditInput = {
  stream: string;
  actorId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  /** Never put citizen names or citizenship numbers here. */
  payload?: Record<string, unknown>;
  reason?: string | null;
};

export type VerifyResult = {
  valid: boolean;
  streamsChecked: number;
  eventsChecked: number;
  firstBroken: ChainBreak | null;
};

const VERIFY_PAGE_SIZE = 1000;

@Injectable()
export class AuditService {
  constructor(private readonly repo: AuditRepository) {}

  /**
   * Appends an event to its stream's hash chain. Pass the caller's transaction so the audit
   * event commits or rolls back together with the change it records.
   */
  append(input: AuditInput, tx?: Tx): Promise<StoredEvent> {
    return tx ? this.appendIn(tx, input) : this.repo.transaction((t) => this.appendIn(t, input));
  }

  private async appendIn(tx: Tx, input: AuditInput): Promise<StoredEvent> {
    await this.repo.lockStream(tx, input.stream);
    const head = await this.repo.head(tx, input.stream);
    const fields = {
      stream: input.stream,
      seq: (head?.seq ?? 0) + 1,
      occurredAt: new Date(),
      actorId: input.actorId ?? null,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId ?? null,
      payload: input.payload ?? {},
      reason: input.reason ?? null,
    };
    const prevHash = head?.hash ?? GENESIS_HASH;
    const event = { ...fields, prevHash, hash: hashEvent(prevHash, fields) };
    await this.repo.insert(tx, event);
    return event;
  }

  /** Walks one stream (or all of them) and reports the first event that breaks its chain. */
  async verify(stream?: string): Promise<VerifyResult> {
    const streams = stream ? [stream] : await this.repo.streams();
    let eventsChecked = 0;
    for (const name of streams) {
      const verifier = new ChainVerifier(name);
      let afterSeq = 0;
      for (;;) {
        const page = await this.repo.page(name, afterSeq, VERIFY_PAGE_SIZE);
        for (const event of page) {
          const broken = verifier.feed(event);
          if (broken) {
            return {
              valid: false,
              streamsChecked: streams.length,
              eventsChecked,
              firstBroken: broken,
            };
          }
          eventsChecked += 1;
        }
        if (page.length < VERIFY_PAGE_SIZE) break;
        afterSeq = page[page.length - 1]!.seq;
      }
    }
    return { valid: true, streamsChecked: streams.length, eventsChecked, firstBroken: null };
  }

  list(filter: EventFilter, limit: number, cursor?: { stream: string; seq: number }) {
    return this.repo.list(filter, limit, cursor);
  }
}
