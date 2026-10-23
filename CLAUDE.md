# Setu — working rules for Claude Code

Setu is a web platform for migrating legacy Nepal government records into a modern system
with proof at every step. The full design is in `docs/ARCHITECTURE.md`. Read it before
starting any phase, and follow it. If something in it looks wrong or unclear, say so and
ask before changing the design.

## How we work

- Build one phase at a time, in the order listed under "Build phases" in `docs/ARCHITECTURE.md`.
- Each phase must end with code that runs locally and tests that pass. Stop at the end of the
  phase, show me how to run and check it, and wait for my go-ahead before the next phase.
- Keep changes small. Do not add features, packages or modules that the current phase does
  not need.
- If a phase is too big for one step, split it into smaller steps and tell me the split first.
- When something fails, find the cause before changing code. Add a failing test for the bug,
  then fix it.

## Stack (do not swap without asking)

- Node.js 22, TypeScript strict mode, NestJS
- PostgreSQL 16 (schemas: `control`, `staging`, `target`, `audit`), Prisma + raw SQL via `pg`
- Redis 7 + BullMQ, MinIO, zod, pino, Jest, supertest, Testcontainers, fast-check
- Docker Compose for local services

## Code rules

- Module layout: `controller` (HTTP only) → `service` (logic, transactions) → `repository`
  (the only DB access). Unit tests in `*.spec.ts` next to the file.
- Modules talk only through exported services, never through another module's tables.
- `transforms` and `matching` are pure functions: no database, network or file access.
- Validate every input with zod. Errors use RFC 9457 problem+json.
- Store dates in AD (`date` type). Convert to BS only at the API edge.
- `audit.events` is append-only. Never write code that updates or deletes it.
- Test names describe behaviour: `it('quarantines a row whose ward exceeds the ward count')`.
- Tests run against real Postgres and Redis (Testcontainers). Do not mock the database.

## Data and secrets

- Synthetic data only. Never add real names, citizenship numbers or other real personal data,
  including in fixtures, seeds and examples.
- Never log names or citizenship numbers.
- Secrets come from environment variables. Commit `.env.example`, never `.env`.

## Git

- Conventional Commits: `feat(transforms): add Preeti to Unicode converter`.
- One phase = one or a few small commits with clear messages.
- Do not push, open pull requests or rewrite history unless I ask.

## Commands (fill in as they are created)

- Start services: `docker compose up -d`
- Run API: `npm run start:api`
- Run worker: `npm run start:worker`
- Tests: `npm test` (unit), `npm run test:int` (integration), `npm run test:e2e`
- Lint and types: `npm run lint && npm run typecheck`
- Format: `npm run format` (CI runs `npm run format:check`)
