# 2. One BullMQ queue per stage, idempotent batches, a sweeper

Status: accepted · 2026-10-24

## Context

A run moves rows through Extract → Transform → Validate → Match → Load in batches. Workers
crash, Redis drops connections, and jobs are retried. No row may be lost or loaded twice.

## Decision

- One queue per stage. A job is "run stage X of batch B"; its id is `X-B`, so queuing the same
  work twice is a no-op.
- Each stage is one database transaction that locks the batch row (`FOR UPDATE`) and checks
  `batches.stage` is still X. A retried, duplicated or resumed job finds the work done and
  stops. Every write is keyed (staged row per raw row, person id derived from the raw row id,
  lineage composite key) as a second line of defence.
- The stage is advanced in the same transaction as the work; the next job is queued after the
  commit. A sweeper re-queues work that was committed but never queued (a crash in between)
  and batches with no heartbeat for `PIPELINE_STALE_SECONDS`.
- BullMQ's stalled-job detection returns a dead worker's jobs to the queue.
- Infrastructure errors retry 3 times (1 s, 4 s, 16 s); data errors never retry, they
  quarantine.
- Two stages are ordered within a run. Match runs batch by batch in file order (see ADR 5).
  Load is serialized per run with a transaction-scoped advisory lock: batches loading at the
  same moment could each miss the other's citizenship numbers and households, collide and fail
  again on every retry (found by `pipeline-concurrency.e2e-spec.ts`).

## Consequences

- The crash test kills a real worker process mid-run; a new worker finishes it with no
  duplicates.
- Ordering Match and Load limits parallelism to Extract, Transform and Validate. Measured
  impact is in ADR 6.
- Run start is idempotent (a second start of a started run returns it unchanged), which covers
  the double-click case; there is no generic `Idempotency-Key` header yet.
