# 4. Address crosswalk: reference data as a versioned file, review for split VDCs

Status: accepted · 2026-10-25

## Context

Legacy records give addresses as pre-2017 Village Development Committees (VDCs); the target
model uses the 753 local units. Most VDCs became part of one unit; some were split across
several, and their records cannot be placed from the name alone.

## Decision

- Reference data lives in `prisma/reference/address.json` and is loaded idempotently by
  `npm run db:reference` (also by `db:seed` and the test setup). The `vdcToLocalUnit`
  transform and `wardInUnit` rule receive it as an argument, so they stay pure.
- A VDC whose `localUnitCode` is null needs review: its rows are quarantined with a
  "needs review" reason instead of being guessed.
- The transform tolerates how clerks wrote VDCs: case, spacing, and "VDC", "V.D.C." or
  "Gabisa" suffixes. An unknown VDC fails rather than being matched loosely.
- Load creates one household per legacy household number per run; the member from the
  earliest source row becomes the head once all batches are loaded.

## Consequences and limits

- The file holds only the units and VDCs of the three districts in the synthetic register,
  with Setu's own codes (`kaski-pokhara`), not official ones. The mappings were checked against
  public sources; Bhalam (Kaski) is marked for review because no source confirmed a single
  unit. Replace the file with the full 753-unit list before real data.
- Legacy ward numbers are VDC wards (1–9). The register mapping checks `max:9` and
  `wardInUnit`, and stores the ward as recorded. Translating old wards to new wards needs a
  ward-level crosswalk, which is not built.
