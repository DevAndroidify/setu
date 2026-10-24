# 1. A modular monolith with an API process and a worker process

Status: accepted · 2026-10-23

## Context

One small team builds and runs Setu. Imports of 100,000 rows must not slow down officers using
the API, and the design has to be easy to explain and to operate on one server.

## Decision

One codebase, deployed as two processes from the same image:

- `apps/api`: HTTP only. Validates input, records intent (runs, approvals, decisions) and
  enqueues work. Never does heavy work in a request.
- `apps/worker`: BullMQ consumers that run the pipeline stages and profiling.

Inside, the code is split into modules (`src/modules/*`) that talk only through exported
services, with the same layers in each: controller → service → repository. Only a repository
touches the database.

## Consequences

- One build, one deploy, one set of migrations; local development is `docker compose up`.
- API and worker scale separately: more worker processes for faster imports.
- A module could become a service later along the same boundaries, but nothing is split until
  load demands it.
- Module boundaries are a convention enforced by review, not by the runtime. Two places bend
  it on purpose: the duplicate review queue (`MatchesController`) lives in the pipeline
  module, because a decision changes staging rows the pipeline owns; and the matching module
  stores candidates while the pipeline decides which rows to compare.
