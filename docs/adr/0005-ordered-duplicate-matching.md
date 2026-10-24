# 5. Duplicate matching in file order, with blocking and a review band

Status: accepted · 2026-10-25

## Context

Legacy registers enter the same person more than once, often with a different English
spelling. Comparing every pair is quadratic, and with batches processed in parallel the result
must still not depend on timing.

## Decision

- Pure scoring (`src/modules/matching`): Jaro-Winkler on a lossy Devanagari transliteration of
  the Nepali name (and on the English name; the better counts), plus date of birth and the
  father's given name. Names must be alike before anything else counts. A shared citizenship
  number always gets a review; two different numbers never match.
- Thresholds: 0.95 and above links automatically; 0.80 to 0.95 holds the row for a reviewer;
  below that, different people.
- Blocking: rows are compared only within district + birth year, or when they share a
  citizenship number (expression index on `normalized->>'citizenship_no'`).
- A Match stage between Validate and Load compares a batch with earlier rows of the run and
  with persons already in target. Batches match in file order: a batch whose predecessor has
  not matched waits and is woken when it finishes. "Earlier" therefore means earlier in the
  file, and the same file always gives the same result.
- A linked row gets lineage to the existing person and no new record. A held row waits in
  `GET /matches`; `POST /matches/:id/decision` links it or loads it as a new person, with the
  reviewer's reason in the run's audit chain.
- Dry runs stop before matching.

## Consequences

- The generator's planted duplicates are all linked when both rows are valid and share a
  birth date (`matching.e2e-spec.ts`).
- Matching is sequential per run, so it bounds import throughput (ADR 6).
- Rolling back a run deletes only persons it created; it is refused while another run has
  linked rows to them.
