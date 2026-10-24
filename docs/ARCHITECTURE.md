# Setu — Backend Architecture

Oct 23, 2026 · Sagar Pandey

## Overview

Setu is a web platform that moves government records from legacy systems to a modern database, with proof at every step: profiling, validation, reconciliation, lineage and a tamper-evident audit log. It is built as a portfolio project for the SDOC Mid-Level / Senior Developer posts, so every design choice maps to a skill the notice lists.

**Goals**

- Import messy legacy data (CSV, Excel, XML, SQL) without losing a row: every record ends up loaded, quarantined with a reason, or rejected with a reason.
- Fix Nepal-specific legacy problems: Preeti font text, BS dates in mixed formats, Devanagari digits, old VDC addresses, duplicate people.
- Prove the migration was correct: row counts, checksums, field-level sample diffs, saved as reports.
- Govern it: roles, maker-checker approval before production loads, masking of sensitive fields, hash-chained audit trail.

**Out of scope for v1:** real citizen data (synthetic only), live change-data-capture from a running legacy database, microservices.

**How it maps to the job notice**

| Notice skill | Where Setu shows it |
| --- | --- |
| API development | Versioned REST API with OpenAPI docs |
| Integration | Source connectors, compatibility API for legacy clients |
| Programming | TypeScript modules for transforms, matching, pipeline |
| Unit testing | Known-answer tests for every transform, 85%+ coverage on core |
| Debugging | Correlation IDs, structured logs, quarantine reasons |
| Git | Trunk-based flow, conventional commits, PR template |
| System design (Senior) | Modular monolith, API + worker split, staging layers |
| Database design (Senior) | Separate schemas, constraints, indexes, audit triggers |
| Performance tuning (Senior) | Chunked loads, COPY, indexes, load test |
| CI/CD (Senior) | GitHub Actions: lint, test, build, Docker image |

Sample domain: a household and person register with synthetic data. It exercises names, dates, addresses and duplicates in one dataset.

## Architecture

Setu is a modular monolith: one codebase deployed as two processes, an API and a worker, sharing PostgreSQL, Redis and MinIO. The API never does heavy work, so a 100,000-row import never slows other requests.

```
┌──────────────────────────────────────────────────────────────────────┐
│ Clients                                                              │
│ Officer browser (React, built after the backend) and legacy clients  │
│ through the compat API                                               │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ HTTPS, JWT
┌───────────────────────────────▼──────────────────────────────────────┐
│ Setu codebase (modular monolith)                                     │
│ ┌──────────────────────────────┐    ┌──────────────────────────────┐ │
│ │ API process (NestJS)         │    │ Worker process (BullMQ)      │ │
│ │ REST /api/v1, OpenAPI, guards│───▶│ Extract, transform, validate │ │
│ │ Validates input, starts runs │    │ Match, load, reconcile       │ │
│ │ Enqueues jobs in Redis       │    │ Batches of 1,000, retries    │ │
│ └──────────────────────────────┘    └──────────────────────────────┘ │
└──────────┬───────────────────────────────┬───────────────────┬───────┘
           ▼                               ▼                   ▼
┌────────────────────────┐ ┌──────────────────────────┐ ┌────────────────────────┐
│ Redis 7                │ │ PostgreSQL 16            │ │ MinIO (S3-compatible)  │
│ One queue per stage    │ │ Schemas: control,        │ │ Uploaded legacy files  │
│ Retries, crash recovery│ │ staging, target, audit   │ │ Immutable, by sha256   │
│ Live progress events   │ │ Audit is append-only     │ │ Daily audit checkpoints│
└────────────────────────┘ └──────────────────────────┘ └────────────────────────┘
```

The API validates and records; the worker does the migration work in batches; Redis carries jobs between them.

**One run, end to end**

1. An operator uploads a legacy file; the API stores it in MinIO and records it in `control`.
2. The operator saves a mapping, previews it, and creates a run; a production run waits for an approver.
3. On start, the API enqueues one job per batch and returns `202` with the run ID.
4. The worker processes each batch through the stages, writing `staging`, `target`, `lineage` and `audit`.
5. Progress events flow through Redis to the API, which streams them to the browser over Server-Sent Events.
6. After the last batch, the worker writes the reconciliation report and marks the run completed.

Both processes scale on their own: more worker containers for faster imports, more API containers for more users.

## Tech stack

Node.js 22 + TypeScript on NestJS, PostgreSQL 16, Redis + BullMQ, MinIO, all run with Docker Compose. Every choice is mainstream and easy to defend in an interview.

| Layer | Choice | Why |
| --- | --- | --- |
| Language | TypeScript (strict mode) | Types catch mapping and transform bugs before runtime |
| Framework | NestJS | Built-in modules, dependency injection, guards, interceptors: fits a modular monolith |
| Database | PostgreSQL 16 | JSONB for raw legacy rows, schemas, triggers, COPY for fast loads |
| Data access | Prisma for CRUD + raw SQL (via `pg`) for triggers, COPY and bulk upserts | Productive for normal code, full control where performance matters |
| Queue | BullMQ on Redis 7 | Retries, backoff, progress, flows (parent/child jobs), concurrency per worker |
| File storage | MinIO (S3-compatible) | Uploaded legacy files kept immutable; same API as AWS S3 later |
| Validation | zod | One schema gives runtime validation and TypeScript types |
| Auth | JWT access token (15 min) + refresh token (httpOnly cookie), argon2 password hashing | Standard, stateless API auth |
| Logging | pino + nestjs-pino | Fast structured JSON logs with request correlation IDs |
| Metrics | prom-client (Prometheus format) | Job duration, rows/sec, failure counts |
| API docs | @nestjs/swagger (OpenAPI 3) | Interactive docs at /docs |
| Tests | Jest, supertest, Testcontainers (real Postgres + Redis in tests), fast-check (property tests) | Tests run against the real database, not mocks |
| Load test | k6 | Measure import throughput and API latency |
| Nepali data | @remotemerge/nepali-date-converter, preeti converter (own port with tests), nepali-geo data | BS dates, legacy fonts, admin units |
| Quality | ESLint, Prettier, Husky + lint-staged, commitlint | Consistent code and commit history |
| CI | GitHub Actions | Lint, type-check, test, build, Docker image on every PR |

If NestJS feels too heavy in the time available, the same module boundaries work in Express + TypeScript; only the wiring changes.

## Project structure

One repository, one codebase, two entry points (`api` and `worker`). Modules talk to each other only through their exported service interfaces, never by reaching into another module's tables or internals.

```
setu/
├── apps/
│   ├── api/                 # HTTP entry point (NestJS app)
│   │   └── main.ts
│   └── worker/              # BullMQ worker entry point
│       └── main.ts
├── src/
│   ├── modules/
│   │   ├── auth/            # login, tokens, roles, guards
│   │   ├── sources/         # connectors + file upload
│   │   ├── profiling/       # column stats, encoding/date detection
│   │   ├── mappings/        # versioned mapping specs
│   │   ├── transforms/      # pure transform library (no I/O)
│   │   ├── validation/      # rule engine
│   │   ├── pipeline/        # runs, batches, stages, queue producers
│   │   ├── quarantine/      # rejected rows, fix and retry
│   │   ├── matching/        # duplicate detection + review queue
│   │   ├── reconciliation/  # counts, checksums, sample diffs
│   │   ├── lineage/         # target record -> source row links
│   │   ├── approvals/       # maker-checker workflow
│   │   ├── audit/           # hash-chained audit log + verify
│   │   ├── target/          # the modern person/household API
│   │   └── compat/          # legacy-shaped API (later)
│   ├── shared/
│   │   ├── db/              # Prisma client, raw pg pool, tx helper
│   │   ├── queue/           # BullMQ connection + queue names
│   │   ├── storage/         # MinIO client
│   │   ├── errors/          # error classes + problem+json filter
│   │   ├── logging/         # pino config, correlation ID
│   │   └── config/          # env schema (zod), loaded once
│   └── jobs/                # worker processors, one per stage
├── prisma/
│   ├── schema.prisma
│   └── migrations/          # includes raw SQL for triggers
├── test/
│   ├── fixtures/            # sample legacy files (Preeti, BS dates)
│   ├── integration/
│   └── e2e/
├── tools/
│   ├── generate-legacy-data.ts   # synthetic messy dataset
│   └── tamper-demo.ts            # edits an audit row to show verify failing
├── load/                    # k6 scripts
├── docker-compose.yml
├── .github/workflows/ci.yml
└── docs/                    # ADRs, architecture diagram
```

**Inside each module** the same four layers repeat:

- `*.controller.ts`: HTTP only; parses input with zod DTOs, calls the service.
- `*.service.ts`: business logic; owns transactions.
- `*.repository.ts`: the only file that talks to the database.
- `*.spec.ts` next to each file for unit tests.

The `transforms` and `matching` logic are pure functions with no database or network access, which is what makes them fast to unit test.

## Modules

Fifteen modules, each with one job. The table lists what each owns and the logic worth explaining in an interview.

| Module | Owns | Key logic |
| --- | --- | --- |
| auth | users, roles, refresh tokens | argon2 hashing, JWT rotation, `@Roles()` guard, account lockout after 5 failed logins |
| sources | sources, source files | Upload to MinIO, SHA-256 of the file stored so the same file is never imported twice; connector interface `read(): AsyncIterable<RawRow>` for CSV, Excel, XML, SQL |
| profiling | profile reports | Per column: null %, distinct count, top values, length range, regex pattern classes, Preeti-text likelihood, detected date formats, numeric outliers; streams the file, never loads it whole |
| mappings | mapping specs (versioned) | Declarative JSON: target field, source field(s), transform chain, rules; a new version on every edit; a run pins one version |
| transforms | (no tables, pure code) | Registry of named transforms: `trim`, `preetiToUnicode`, `devanagariDigits`, `bsToAd`, `fiscalYear`, `vdcToLocalUnit`, `splitName`, `transliterate`, `normalizePhone`; each returns `{value, warnings}` |
| validation | rule sets | zod schema per target entity + business rules: citizenship number format, ward within the local unit's ward count, DOB not in the future, household head exists |
| pipeline | runs, batches, stage status | Starts runs, splits into batches of 1,000 rows, enqueues stages, tracks progress, dry-run flag, pause/resume/cancel |
| quarantine | quarantined rows | Stores the raw row, the stage it failed at and all reasons; edit-and-retry and bulk retry after a mapping fix |
| matching | match candidates, merge decisions | Blocking by district + birth year, scoring with Jaro-Winkler on transliterated names + DOB + father's name; thresholds: auto-link above 0.95, review 0.80 to 0.95, ignore below; merge needs a reviewer |
| reconciliation | reports | Source vs target row counts per status, per-column checksums (hash of sorted normalized values), random 1% sample field-by-field diff |
| lineage | lineage links | Every target row stores source file ID, row number, mapping version, run ID and batch ID |
| approvals | approval requests | Maker-checker: the user who starts a production run cannot approve it; approval expires after 24 hours |
| audit | audit events | Hash chain per stream, append-only triggers, `verify` walks the chain, daily chain-head checkpoint |
| target | persons, households, addresses | The clean modern data and its REST API with search, filters and pagination |
| compat | (reads target) | Serves legacy-shaped responses from the new database so old clients keep working during the switch (phase 2) |

**Example mapping spec** (one field):

```json
{
  "target": "person.dob_ad",
  "from": ["JANMA_MITI"],
  "transforms": [
    { "name": "devanagariDigits" },
    { "name": "bsToAd", "args": { "formats": ["YYYY/M/D", "YYYY-MM-DD"] } }
  ],
  "rules": ["notFuture", "after:1940-01-01"],
  "onError": "quarantine"
}
```

## Database design

Four PostgreSQL schemas keep concerns apart: `control` (how migrations run), `staging` (data in transit), `target` (clean data), `audit` (evidence). The app's database role cannot UPDATE or DELETE anything in `audit`.

**control**

| Table | Key columns | Notes |
| --- | --- | --- |
| users | id, email (unique), password_hash, role, failed_logins, locked_until | role: operator, reviewer, approver, auditor, admin |
| sources | id, name, kind (csv, excel, xml, sql), agency, created_by | One legacy system per source |
| source_files | id, source_id, object_key, sha256 (unique), encoding, row_count | Duplicate upload blocked by the sha256 unique index |
| profiles | id, source_file_id, report (jsonb), created_at | One per file |
| mappings | id, source_id, version, spec (jsonb), created_by | Unique (source_id, version); never edited, only new versions |
| runs | id, source_file_id, mapping_id, mode (dry_run, production), status, counts (jsonb), approved_by | status: draft, awaiting_approval, queued, running, completed, failed, rolled_back |
| batches | id, run_id, seq, row_from, row_to, status, attempts, error | Unique (run_id, seq) |
| approvals | id, run_id, requested_by, decided_by, decision, reason, expires_at | CHECK requested_by <> decided_by |

**staging**

| Table | Key columns | Notes |
| --- | --- | --- |
| raw_rows | id, run_id, batch_id, row_no, raw (jsonb), row_hash | Exactly what the legacy file held |
| staged_rows | id, raw_row_id, normalized (jsonb), warnings (jsonb), status | status: valid, quarantined, duplicate_review, loaded |
| quarantine | id, staged_row_id, stage, reasons (jsonb), resolved_by, resolved_at | Partial index on unresolved rows |
| match_candidates | id, row_a, row_b, score, features (jsonb), decision, decided_by | decision: link, not_same, pending |

**target**

| Table | Key columns | Notes |
| --- | --- | --- |
| local_units | code, name_en, name_ne, district_code, province, type, ward_count | Reference data: 753 units |
| legacy_vdcs | id, name_en, name_ne, district_code, local_unit_code (nullable) | Null when the old VDC split across units: needs review |
| households | id, local_unit_code, ward_no, tole, head_person_id | ward_no checked against ward_count |
| persons | id, household_id, name_ne, name_en, gender, dob_ad, citizenship_no, father_name_ne, created_by_run | citizenship_no unique where not null |
| lineage | target_table, target_id, raw_row_id, mapping_id, run_id, batch_id | Composite PK (target_table, target_id, raw_row_id) |

**audit**

| Table | Key columns | Notes |
| --- | --- | --- |
| events | stream, seq, occurred_at, actor_id, action, entity, entity_id, payload (jsonb), reason, prev_hash, hash | PK (stream, seq); trigger blocks UPDATE, DELETE, TRUNCATE |
| checkpoints | stream, seq, hash, created_at | Daily chain head, also exported to MinIO with object lock |

**Indexes and constraints worth naming in an interview**

- `persons (lower(name_en), dob_ad)` B-tree and a `pg_trgm` GIN index on `name_en` for fuzzy search.
- `quarantine (stage) WHERE resolved_at IS NULL`: partial index keeps the open-issues query fast.
- `staged_rows (raw_row_id)` unique: one staged result per raw row, which makes reprocessing idempotent.
- Store dates as `date` in AD; BS is computed at the API edge, never stored as text.
- Batch loads use `INSERT ... ON CONFLICT DO NOTHING` keyed on lineage, so a retried batch never double-inserts.

**Append-only trigger (sketch)**

```sql
CREATE FUNCTION audit.block_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit.events is append-only';
END $$ LANGUAGE plpgsql;

CREATE TRIGGER no_update_delete
BEFORE UPDATE OR DELETE ON audit.events
FOR EACH ROW EXECUTE FUNCTION audit.block_change();

CREATE TRIGGER no_truncate
BEFORE TRUNCATE ON audit.events
FOR EACH STATEMENT EXECUTE FUNCTION audit.block_change();
```

## API design

REST under `/api/v1`, JSON in and out, documented with OpenAPI at `/docs`. Long work never blocks a request: endpoints that start work return `202 Accepted` with a run ID, and the client polls or listens for progress.

**Conventions**

- Plural nouns, no verbs in paths, except state-change actions as sub-resources (`/runs/:id/approve`).
- Cursor pagination: `?limit=50&cursor=<opaque>`; response `{ data, nextCursor }`.
- Filtering and sorting: `?status=quarantined&sort=-createdAt`.
- Errors as RFC 9457 problem+json: `{ type, title, status, detail, errors[] }`, with the correlation ID in the `X-Request-Id` header.
- `Idempotency-Key` header on POSTs that start runs, so a double-click never starts two runs.
- Dates: AD as ISO `YYYY-MM-DD`; add `?calendar=bs` to also get BS values in responses.
- Progress: Server-Sent Events at `/runs/:id/events` (simpler than WebSockets for one-way updates).

**Endpoints**

| Method | Path | Role | Purpose |
| --- | --- | --- | --- |
| POST | /auth/login | public | Get access + refresh token |
| POST | /auth/refresh | public | Rotate tokens |
| GET | /me | any | Current user and role |
| POST | /sources | operator | Register a legacy source |
| POST | /sources/:id/files | operator | Upload a file (multipart) |
| GET | /files/:id/profile | operator | Profiling report |
| POST | /sources/:id/mappings | operator | Save a new mapping version |
| POST | /mappings/:id/preview | operator | Transform the first 50 rows, no writes |
| POST | /runs | operator | Create a run (dry_run or production) |
| POST | /runs/:id/submit | operator | Ask for approval (production only) |
| POST | /runs/:id/approve | approver | Approve or reject with a reason |
| POST | /runs/:id/start | operator | Queue an approved run |
| POST | /runs/:id/pause, /resume, /cancel | operator | Control a running run |
| GET | /runs/:id | any | Status and counts |
| GET | /runs/:id/events | any | Live progress (SSE) |
| POST | /runs/:id/rollback | approver | Undo a run's loaded batches |
| GET | /runs/:id/reconciliation | auditor | Reconciliation report (JSON or CSV) |
| GET | /quarantine | operator | Open rejected rows, filterable by run and reason |
| PATCH | /quarantine/:id | operator | Fix a row's values |
| POST | /quarantine/retry | operator | Retry selected or all fixed rows |
| GET | /matches | reviewer | Duplicate candidates awaiting review |
| POST | /matches/:id/decision | reviewer | Link or mark not-same |
| GET | /persons, /persons/:id | any | Search clean records (masked by role) |
| GET | /persons/:id/lineage | auditor | Source rows behind a record |
| GET | /audit/events | auditor | Audit trail, filterable |
| GET | /audit/verify | auditor | Walk the hash chain, report first broken link |
| GET | /health, /metrics | ops | Liveness, readiness, Prometheus metrics |

## Migration pipeline

A run moves rows through six stages in batches of 1,000. Every row ends in exactly one place: loaded, quarantined, or waiting for duplicate review. Nothing is silently dropped.

**Stages** (each is its own BullMQ queue and processor in `src/jobs/`)

1. **Extract**: stream the file from MinIO through the source connector; write `raw_rows` with a `row_hash`. Encoding is decoded here (Windows-1252, UTF-8, UTF-16).
2. **Transform**: apply the pinned mapping version's transform chains; write `staged_rows.normalized` plus warnings.
3. **Validate**: run zod schemas and business rules; failures go to `quarantine` with every reason, not just the first.
4. **Match**: score candidates against existing `persons` and within the run; high scores auto-link, mid scores go to the review queue and hold that row.
5. **Load**: insert into `target` with `ON CONFLICT DO NOTHING`, write `lineage` rows in the same transaction. Dry runs stop before this stage.
6. **Reconcile**: after the last batch, compute counts, checksums and the sample diff; save the report; mark the run completed.

**Reliability rules**

- **Batches**: a BullMQ flow per run, one child job per batch per stage; concurrency 4 per worker, configurable.
- **Idempotency**: every write is keyed (`raw_row_id`, lineage composite key), so re-running a batch after a crash produces the same result.
- **Retries**: 3 attempts with exponential backoff (1s, 4s, 16s) for infrastructure errors (DB timeout, Redis drop). Data errors never retry; they quarantine.
- **Resume**: on worker restart, batches still marked `running` with no heartbeat for 60s are re-queued.
- **Pause/cancel**: the processor checks the run's status between batches.
- **Rollback**: `POST /runs/:id/rollback` deletes target rows by `lineage.run_id` in reverse batch order inside transactions, marks staged rows back to `valid`, and writes an audit event. Rollback is refused if later runs have modified those records.
- **Backpressure**: Extract pauses when the transform queue holds more than 20 waiting batches.

## Security and privacy

Three layers: who you are (auth), what you may do (roles and approval), and proof of what you did (audit). Sensitive fields are masked unless a role needs them, in line with the Privacy Act 2075's duty on public bodies to protect personal information.

**Roles**

| Action | Operator | Reviewer | Approver | Auditor | Admin |
| --- | --- | --- | --- | --- | --- |
| Upload, map, dry run | yes | no | no | no | yes |
| Fix quarantined rows | yes | no | no | no | no |
| Decide duplicate matches | no | yes | no | no | no |
| Approve production run, rollback | no | no | yes | no | no |
| See unmasked citizenship no. | no | yes (with reason) | no | yes (with reason) | no |
| Read audit log, verify chain | no | no | no | yes | yes |
| Manage users | no | no | no | no | yes |

Admin deliberately cannot approve runs or see unmasked data: no single account can do everything.

**Controls**

- **Masking**: `citizenship_no` returned as `**-**-**-12345` (last 5 visible) by default; `?unmask=true` requires a role that allows it plus a `reason`, which is written to the audit log.
- **Maker-checker**: a production run needs approval from a different user; enforced in the service and by a CHECK constraint.
- **Input safety**: zod on every DTO, upload size limit 50 MB, file type sniffed from content not extension, CSV formula injection (`=`, `+`, `-`, `@` prefixes) escaped on export.
- **Transport and headers**: helmet, strict CORS allowlist, rate limit on `/auth/*` (10/min per IP).
- **Secrets**: only from environment variables validated at startup; `.env` never committed.
- **Least privilege in Postgres**: app role has INSERT-only on `audit.events`; migrations run under a separate owner role.

**Hash-chained audit log**

- Each event's `hash = SHA-256(prev_hash + canonical JSON of {stream, seq, occurred_at, actor_id, action, entity, entity_id, payload, reason})`.
- One chain per stream (per run, plus a `global` stream for auth and user changes) so writes don't serialize on one lock.
- Inserting is done with `SELECT ... FOR UPDATE` on the stream's head row to keep `seq` gap-free.
- `GET /audit/verify` recomputes every hash and returns the first broken `seq`, if any.
- Limit, stated honestly: someone with full database owner access could rewrite the whole chain. Daily checkpoints exported to MinIO with object lock make that detectable.

## Testing strategy

Most tests are fast unit tests on pure logic; fewer integration tests run against real Postgres and Redis in containers; a handful of end-to-end tests drive a full run through the HTTP API. No test mocks the database.

| Level | Tool | What it covers | Target |
| --- | --- | --- | --- |
| Unit | Jest | Every transform, validation rule, match scorer, hash function, mapping spec parser | 90% line coverage on `transforms`, `validation`, `matching`, `audit` |
| Property | fast-check | `bsToAd(adToBs(x)) === x` for every date in range; Preeti conversion never throws; hash chain verify passes for any random event sequence | Runs in CI with 1,000 cases each |
| Golden (known-answer) | Jest + fixture files | Preeti samples with expected Unicode; BS dates on month boundaries (e.g. last day of Chaitra); known VDC-to-unit mappings | Each fixture checked into `test/fixtures` |
| Integration | Jest + Testcontainers | Repositories, triggers (audit UPDATE must fail), unique constraints, a pipeline stage against real Redis | Every repository and every processor |
| API / contract | supertest | Status codes, problem+json shape, role guards (operator gets 403 on approve), pagination | Every endpoint, happy path + main failure |
| End-to-end | supertest + generated dataset | Upload messy file → profile → map → dry run → approve → run → reconcile → rollback; asserts loaded + quarantined + pending = total | 3 scenarios: clean, messy, crash mid-run |
| Load | k6 | Import 100,000 rows; API p95 latency under load | Baseline numbers recorded in README |

**Rules**

- Tests are named by behaviour: `it('quarantines a row whose ward exceeds the local unit ward count')`.
- Every bug found gets a failing test first, then the fix (shows debugging discipline).
- The crash scenario kills the worker mid-run and asserts the resumed run has no duplicates.
- The tamper test edits an audit row as the owner role and asserts `/audit/verify` reports that exact `seq`.
- CI fails if coverage on core modules drops below target.

## Code quality, Git and CI/CD

The repository itself is part of the portfolio: an interviewer will open the commit history and a pull request before reading any code.

**Git workflow**

- Trunk-based: `main` is always green; short-lived branches `feat/…`, `fix/…`, `test/…`, merged by pull request.
- Conventional Commits enforced by commitlint: `feat(transforms): add Preeti to Unicode converter`.
- One phase = one or a few small PRs, each with a description: what, why, how tested.
- PR template with a checklist: tests added, docs updated, migration included, no secrets.
- Tags per milestone (`v0.1.0` core slice) with a CHANGELOG.

**Code review habits** (review your own PRs as if for someone else)

- Does every new branch of logic have a test?
- Are errors typed and handled, or swallowed?
- Any N+1 query or unbounded `SELECT`?
- Does the change respect module boundaries?

**Static checks**

- TypeScript `strict`, `noUncheckedIndexedAccess`.
- ESLint (typescript-eslint recommended + import order), Prettier, run on staged files by Husky + lint-staged.
- Architecture decision records in `docs/adr/` for choices like modular monolith, BullMQ, schema split.

**CI pipeline** (GitHub Actions, on every PR and push to `main`)

1. Install with cache.
2. Lint and type-check.
3. Unit + property tests.
4. Integration and e2e tests with Postgres and Redis service containers.
5. Coverage report; fail below targets.
6. Build the Docker image (multi-stage, non-root user).
7. On `main`: push the image to GitHub Container Registry, tagged with the commit SHA.

**Deploy** (for the demo): `docker compose up` brings up API, worker, Postgres, Redis and MinIO; migrations run as a one-off container before the API starts.

## Observability and performance

Every request and job carries one correlation ID from the HTTP call through the queue to the database, so one search in the logs shows a row's whole journey.

**Observability**

- **Logs**: pino JSON with `requestId`, `runId`, `batchId`, `userId`; no personal data in logs (names and citizenship numbers redacted by pino's `redact` option).
- **Metrics** at `/metrics`: `setu_rows_processed_total{stage,status}`, `setu_batch_duration_seconds` (histogram), `setu_queue_waiting{queue}`, `setu_http_request_duration_seconds`.
- **Health**: `/health/live` (process up) and `/health/ready` (Postgres, Redis, MinIO reachable).
- **Run timeline**: each stage start/end recorded per batch, shown later in the frontend as a progress view.

**Performance tuning plan**

| Technique | Where | Expected effect |
| --- | --- | --- |
| Stream files, never read whole | Extract | Memory flat regardless of file size |
| Batch inserts with `COPY` or multi-row `INSERT` | Extract, Load | Far fewer round trips than row-by-row inserts |
| Blocking keys before fuzzy matching | Match | Compares within district + birth year instead of every pair |
| Precomputed transliterated name column + trigram index | Match, search | Fuzzy lookups use the index |
| Worker concurrency and batch size as config | Pipeline | Tune with k6 results, not guesses |
| Connection pool sized to workers (e.g. 10 per process) | DB | Avoids pool exhaustion under load |
| `EXPLAIN ANALYZE` on the 5 slowest queries | All | Documented before/after in an ADR |

Measure first: record a baseline (rows/sec for 100,000 rows, API p95) before tuning, then report the improvement in the README. Real numbers beat claims in an interview.

## Build phases

Sixteen small phases. Each ends with something you can run and a test that passes; don't start the next until that's true. Phases 1 to 10 are the core slice that is enough for the practical exam portfolio.

**Core slice**

- [x] **1. Skeleton**: NestJS app, `api` and `worker` entry points, Docker Compose (Postgres, Redis, MinIO), env validation with zod, `/health`. Check: `docker compose up` then `curl /health/ready` returns 200.
- [x] **2. Tooling and CI**: ESLint, Prettier, Husky, commitlint, Jest, GitHub Actions running lint + tests. Check: a PR shows a green CI run.
- [x] **3. Synthetic legacy data**: `tools/generate-legacy-data.ts` makes a CSV in Windows-1252 with Preeti names, mixed BS date formats, Devanagari digits, old VDC names, invalid wards and deliberate duplicates. Check: a snapshot test on a fixed random seed.
- [x] **4. Transform library**: `devanagariDigits`, `bsToAd`, `fiscalYear`, `preetiToUnicode`, `trim`, `splitName`. Check: golden + property tests pass.
- [x] **5. Database schemas**: Prisma models for all four schemas, raw-SQL migration for audit triggers. Check: integration test proves UPDATE on `audit.events` fails.
- [x] **6. Auth and roles**: login, refresh, `@Roles()` guard, seed users per role. Check: API tests for 401 and 403 cases.
- [x] **7. Audit module**: hash-chained append, per-stream lock, `/audit/verify`, tamper demo script. Check: tamper test reports the exact broken `seq`.
- [x] **8. Sources and profiling**: upload to MinIO, sha256 dedupe, streaming CSV connector, profile report. Check: profiling the generated file flags the Preeti column and the date formats.
- [x] **9. Mappings and preview**: versioned specs, transform registry, validation rules, `/preview` on 50 rows. Check: preview of the messy file shows expected normalized values and errors.
- [x] **10. Pipeline**: runs, batches, BullMQ stages Extract → Transform → Validate → Load, quarantine, lineage, dry run. Check: e2e test asserts loaded + quarantined = total; crash test shows no duplicates after resume.

**Second slice**

- [x] **11. Reconciliation and rollback**: counts, checksums, sample diff, CSV export, batch rollback. Check: rollback leaves target identical to before the run.
- [x] **12. Maker-checker approvals**: submit, approve or reject, expiry. Check: same-user approval returns 403.
- [x] **13. Address crosswalk**: local units reference data, legacy VDC table, `vdcToLocalUnit` with an ambiguous-case flag, ward validation. Check: known VDCs map correctly; split ones go to review.
- [x] **14. Duplicate matching**: blocking, Jaro-Winkler on transliterated names, review queue, link decisions. Check: the generator's planted duplicates are found.
- [x] **15. Masking, rate limits, observability**: unmask with reason, pino redaction, Prometheus metrics, SSE progress. Check: logs contain no citizenship numbers.
- [x] **16. Performance and docs**: k6 load test, tuning with before/after numbers, README with diagram and ADRs. Check: 100,000-row run completes and numbers are recorded.

After phase 16: the compatibility API (optional), then the frontend.

## Interview talking points

Be ready to explain these choices in one or two sentences each, including what you'd change at larger scale.

- **Why a modular monolith?** One team, one deployable, clear module boundaries. It can split into services later along those same boundaries if load demands it.
- **Why an anti-corruption layer, not a strangler fig?** SDOC will maintain legacy systems, not only replace them. The layer keeps legacy formats out of the clean model; a strangler facade comes later if an agency retires its old system.
- **How do you make sure no row is lost?** Every row ends loaded, quarantined or in review, and reconciliation checks loaded + quarantined + pending = source count.
- **What happens if the worker crashes mid-run?** Batches are idempotent and keyed, stalled batches are re-queued, and the crash test proves no duplicates.
- **How is the audit log tamper-evident, and what are its limits?** Hash chain plus append-only triggers; full-owner rewrites are caught by external checkpoints.
- **Why store dates in AD?** One sortable, comparable format in the database; BS is a display concern converted at the edge.
- **How do you find duplicates without comparing every pair?** Blocking by district and birth year, then fuzzy scoring, with humans deciding the uncertain middle band.
- **How did you handle Nepali data?** Preeti and Devanagari digits normalized, old VDCs mapped to new local units with ambiguous cases flagged, Unicode output.
- **How does it respect privacy?** Masking by role, unmask only with a logged reason, no personal data in logs, synthetic test data only.
- **What would you add with more time?** Live change-data-capture from a running legacy database, a compatibility API for old clients, and anchoring checkpoints with an external timestamp authority.
