# 3. Four schemas and a hash-chained, append-only audit log

Status: accepted · 2026-10-23

## Context

A migration has to be provable: what came in, what changed, who decided, and that the record
of it was not edited afterwards.

## Decision

- PostgreSQL schemas separate concerns: `control` (how runs run), `staging` (data in transit:
  raw and normalized rows, quarantine, match candidates), `target` (clean data and reference
  tables), `audit` (evidence).
- `audit.events` is append-only: triggers reject UPDATE, DELETE and TRUNCATE. Each event's
  hash covers the previous hash and the canonical JSON of the event; one chain per stream
  (`global`, `run:<id>`), with appends to a stream serialized by an advisory lock so `seq` has
  no gaps. `GET /audit/verify` recomputes the chain and reports the first broken `seq`.
- Dates are stored as AD `date`; BS is computed at the API edge (`?calendar=bs`).

## Consequences

- An edit made with direct database access is detected by verify (the tamper demo shows the
  exact `seq`).
- Not done yet, and stated plainly: the app connects as the schema owner, so the database role
  does not yet enforce INSERT-only on `audit` (the triggers do), and the daily chain-head
  checkpoint exported to MinIO with object lock is not built. Until it is, someone with owner
  access could rewrite a whole chain consistently.
