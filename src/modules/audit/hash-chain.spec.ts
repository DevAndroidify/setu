import fc from 'fast-check';
import {
  canonicalJson,
  ChainedFields,
  ChainVerifier,
  GENESIS_HASH,
  hashEvent,
  StoredEvent,
} from './hash-chain';

const STREAM = 'run-1';

/** Builds a correctly linked chain from event contents. */
function buildChain(contents: Omit<ChainedFields, 'stream' | 'seq'>[]): StoredEvent[] {
  let prevHash = GENESIS_HASH;
  return contents.map((content, i) => {
    const fields = { ...content, stream: STREAM, seq: i + 1 };
    const event = { ...fields, prevHash, hash: hashEvent(prevHash, fields) };
    prevHash = event.hash;
    return event;
  });
}

const firstBreak = (events: StoredEvent[]) => {
  const verifier = new ChainVerifier(STREAM);
  for (const event of events) {
    const broken = verifier.feed(event);
    if (broken) return broken;
  }
  return undefined;
};

const jsonValue = fc.jsonValue({ maxDepth: 3 });
const eventContent = fc.record({
  occurredAt: fc.date({
    min: new Date('2020-01-01T00:00:00Z'),
    max: new Date('2030-01-01T00:00:00Z'),
    noInvalidDate: true,
  }),
  actorId: fc.option(fc.uuid(), { nil: null }),
  action: fc.constantFrom('run.created', 'run.approved', 'auth.login'),
  entity: fc.constantFrom('run', 'user'),
  entityId: fc.option(fc.uuid(), { nil: null }),
  payload: jsonValue,
  reason: fc.option(fc.string(), { nil: null }),
});

describe('canonicalJson', () => {
  it('sorts keys at every level so key order never changes the text', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: null } })).toBe(
      '{"a":{"c":null,"d":[1,{"y":2,"z":1}]},"b":1}',
    );
  });

  it('serializes dates as ISO strings and drops undefined properties', () => {
    expect(canonicalJson({ at: new Date('2024-01-02T03:04:05.006Z'), gone: undefined })).toBe(
      '{"at":"2024-01-02T03:04:05.006Z"}',
    );
  });

  it('gives the same text for any reordering of the same object', () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), jsonValue), (record) => {
        const reversed = Object.fromEntries(Object.entries(record).reverse());
        return canonicalJson(record) === canonicalJson(reversed);
      }),
    );
  });
});

describe('ChainVerifier', () => {
  it('accepts any correctly built chain', () => {
    fc.assert(
      fc.property(fc.array(eventContent, { minLength: 1, maxLength: 30 }), (contents) => {
        return firstBreak(buildChain(contents)) === undefined;
      }),
      { numRuns: 1000 },
    );
  });

  it('reports the exact seq of any modified event', () => {
    fc.assert(
      fc.property(
        fc.array(eventContent, { minLength: 1, maxLength: 30 }),
        fc.nat(),
        (contents, pick) => {
          const events = buildChain(contents);
          const target = pick % events.length;
          events[target] = { ...events[target]!, action: `${events[target]!.action}.tampered` };
          return firstBreak(events)?.seq === target + 1;
        },
      ),
      { numRuns: 1000 },
    );
  });

  it('reports a deleted event as a gap in the sequence', () => {
    const events = buildChain([
      {
        occurredAt: new Date(0),
        actorId: null,
        action: 'a',
        entity: 'e',
        entityId: null,
        payload: {},
        reason: null,
      },
      {
        occurredAt: new Date(1),
        actorId: null,
        action: 'b',
        entity: 'e',
        entityId: null,
        payload: {},
        reason: null,
      },
      {
        occurredAt: new Date(2),
        actorId: null,
        action: 'c',
        entity: 'e',
        entityId: null,
        payload: {},
        reason: null,
      },
    ]);
    expect(firstBreak([events[0]!, events[2]!])).toEqual({
      stream: STREAM,
      seq: 3,
      reason: 'expected seq 2, found 3 (missing or reordered events)',
    });
  });

  it('reports a rehashed event whose link to the previous one no longer holds', () => {
    const events = buildChain([
      {
        occurredAt: new Date(0),
        actorId: null,
        action: 'a',
        entity: 'e',
        entityId: null,
        payload: {},
        reason: null,
      },
      {
        occurredAt: new Date(1),
        actorId: null,
        action: 'b',
        entity: 'e',
        entityId: null,
        payload: {},
        reason: null,
      },
    ]);
    // Rewriting event 1 and recomputing its own hash still breaks event 2's prev_hash link.
    const { prevHash: _prev, hash: _hash, ...fields } = { ...events[0]!, action: 'forged' };
    const forged = { ...fields, prevHash: GENESIS_HASH, hash: hashEvent(GENESIS_HASH, fields) };
    expect(firstBreak([forged, events[1]!])?.seq).toBe(2);
  });
});
