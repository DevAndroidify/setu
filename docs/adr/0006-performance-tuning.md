# 6. Performance: measured on a 100,000-row import, then tuned

Status: accepted · 2026-10-24

## Context

The design says to measure before tuning. `load/import.js` (k6) runs one production import
of a generated 100,000-row register through the API until the run completes; `load/api.js`
measures search latency with 20 users. Both run on one laptop (WSL2, 12 cores, 4 GB RAM) with
Postgres, Redis and MinIO in Docker, defaults `PIPELINE_BATCH_SIZE=1000` and
`PIPELINE_CONCURRENCY=4`. Per-stage times come from the worker's
`setu_batch_duration_seconds` histogram.

## First run: a bug, not a slowdown

The first 100,000-row run failed at batch 48. The match stage looked up the persons behind
every candidate row with Prisma `in: [...]`, which sends one bind parameter per id; at 32,768
ids Postgres refuses the statement. Fixed by passing one array parameter (`= ANY($1)`), with an
integration test that looks up 40,000 ids (`test/integration/lineage.int-spec.ts`). The review
queue's row filter had the same pattern and was fixed the same way.

## Baseline

| Measure | Value |
| --- | --- |
| 100,000-row import, start to completed | 325 s (308 rows/s) |
| Mean time per batch: transform / validate / match / load | 0.81 / 0.32 / **2.81** / 0.82 s |
| API, 20 users: search p95 / open person p95 / throughput | 53 ms / 51 ms / 507 req/s |

Matching dominated and grew with every batch. `EXPLAIN (ANALYZE, BUFFERS)` of the candidate
query for batch 30 showed why: its 1,000 rows touched 201 of the district + birth-year blocks,
so the query returned 33,000 rows (nearly every row matched so far) by sequential scans, and
each was compared in memory. Work per batch grew linearly with the run, so the run was
quadratic.

## Changes, each measured on its own

1. **Block by district + exact date of birth** instead of district + birth year. This loses no
   match the scorer can find: with different birth dates a pair scores at most
   name 0.55 + father 0.20 = 0.75, below the 0.80 review threshold (a property test now checks
   this over 1,000 random pairs), and shared citizenship numbers are compared across blocks
   anyway. A migration rewrites existing keys. Candidate rows per batch fell from about
   33,000 to a handful.
2. **Prepare each record once** (transliteration and normalized names) instead of once per
   compared pair.

| Version | Import | Rows/s | Match per batch | Linked | Held for review |
| --- | --- | --- | --- | --- | --- |
| Baseline | 325 s | 308 | 2.81 s | 3,366 | 2,082 |
| 1. Exact-date blocks | 102 s | 980 | 0.41 s | 3,366 | 2,082 |
| 1 + 2. Records prepared once | **94 s** | **1,067** | 0.53 s | 3,366 | 2,082 |

The same 3,366 links and 2,082 reviews in every version show the tuning changed speed, not
results. Change 2 is within run-to-run noise on this machine; it is kept because it removes
repeated work at no cost. The API was unaffected (search p95 55 ms, 481 req/s after).

## Where the time goes now, and what would come next

Loads run one batch at a time per run (ADR 2), and load time per batch now includes waiting
for that lock (1.56 s mean, mostly waiting), so a single run is bound by the load chain. Next
steps, measured the same way before adopting either: `COPY` into a staging table instead of
`createMany` for persons and lineage, and larger batches (`PIPELINE_BATCH_SIZE`) to cut
per-batch overhead. Several runs from different sources still load in parallel.

Raw k6 results are in `load/results/`.
