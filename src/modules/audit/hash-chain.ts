import { createHash } from 'node:crypto';

/** prev_hash of the first event in every stream. */
export const GENESIS_HASH = '0'.repeat(64);

/** The fields an event's hash covers. Changing any of them breaks the chain from that event on. */
export type ChainedFields = {
  stream: string;
  seq: number;
  occurredAt: Date;
  actorId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  payload: unknown;
  reason: string | null;
};

export type StoredEvent = ChainedFields & { prevHash: string; hash: string };

/**
 * JSON with object keys sorted at every level and no whitespace, so the same value always
 * serializes to the same text (Postgres jsonb does not preserve key order).
 */
export function canonicalJson(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v ?? null)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** hash = SHA-256(prev_hash + canonical JSON of the chained fields), hex encoded. */
export function hashEvent(prevHash: string, fields: ChainedFields): string {
  return createHash('sha256')
    .update(prevHash + canonicalJson(fields))
    .digest('hex');
}

export type ChainBreak = { stream: string; seq: number; reason: string };

/**
 * Checks one stream's events, fed in seq order, without holding them all in memory. Reports the
 * first event whose sequence, link or content does not match.
 */
export class ChainVerifier {
  private expectedSeq = 1;
  private prevHash = GENESIS_HASH;

  constructor(private readonly stream: string) {}

  feed(event: StoredEvent): ChainBreak | undefined {
    const at = (reason: string): ChainBreak => ({ stream: this.stream, seq: event.seq, reason });
    if (event.stream !== this.stream) return at(`event belongs to stream ${event.stream}`);
    if (event.seq !== this.expectedSeq) {
      return at(
        `expected seq ${this.expectedSeq}, found ${event.seq} (missing or reordered events)`,
      );
    }
    if (event.prevHash !== this.prevHash) return at('prev_hash does not match the previous event');
    const { prevHash: _prev, hash: _hash, ...fields } = event;
    if (hashEvent(event.prevHash, fields) !== event.hash) {
      return at('content does not match its hash (the event was modified)');
    }
    this.expectedSeq += 1;
    this.prevHash = event.hash;
    return undefined;
  }
}
