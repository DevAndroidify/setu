-- Constraints, indexes and triggers that Prisma's schema language cannot express.
-- (The trigram index on target.persons is declared in schema.prisma and created in init.)

-- ───────────── control ─────────────

-- Maker-checker: whoever requests approval for a run can never be the one who decides it.
ALTER TABLE "control"."approvals"
  ADD CONSTRAINT "approvals_maker_is_not_checker"
  CHECK ("decided_by" IS NULL OR "decided_by" <> "requested_by");

-- A decision is recorded together with who made it and when.
ALTER TABLE "control"."approvals"
  ADD CONSTRAINT "approvals_decision_complete"
  CHECK (("decision" IS NULL) = ("decided_by" IS NULL) AND ("decision" IS NULL) = ("decided_at" IS NULL));

-- Emails are stored lowercase so the unique index is case-insensitive.
ALTER TABLE "control"."users"
  ADD CONSTRAINT "users_email_lowercase" CHECK ("email" = lower("email"));

ALTER TABLE "control"."source_files"
  ADD CONSTRAINT "source_files_sha256_hex" CHECK ("sha256" ~ '^[0-9a-f]{64}$');

ALTER TABLE "control"."mappings"
  ADD CONSTRAINT "mappings_version_positive" CHECK ("version" >= 1);

ALTER TABLE "control"."batches"
  ADD CONSTRAINT "batches_row_range" CHECK ("row_from" >= 1 AND "row_to" >= "row_from");

-- ───────────── staging ─────────────

-- The open-issues query filters on unresolved rows; resolved ones are rarely read.
CREATE INDEX "quarantine_open_by_stage" ON "staging"."quarantine" ("stage") WHERE "resolved_at" IS NULL;

ALTER TABLE "staging"."match_candidates"
  ADD CONSTRAINT "match_candidates_distinct_rows" CHECK ("row_a" <> "row_b"),
  ADD CONSTRAINT "match_candidates_score_range" CHECK ("score" >= 0 AND "score" <= 1);

-- ───────────── target ─────────────

ALTER TABLE "target"."households"
  ADD CONSTRAINT "households_ward_positive" CHECK ("ward_no" >= 1);

ALTER TABLE "target"."local_units"
  ADD CONSTRAINT "local_units_ward_count_positive" CHECK ("ward_count" >= 1);

-- Exact lookups by name and date of birth, case-insensitive on the name.
CREATE INDEX "persons_lower_name_en_dob_ad" ON "target"."persons" (lower("name_en"), "dob_ad");

-- ───────────── audit ─────────────

-- The audit trail is append-only. These triggers fire for every role, including the owner,
-- so a mistaken UPDATE or DELETE fails loudly instead of rewriting evidence.
CREATE FUNCTION "audit"."block_change"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit.% is append-only', TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END $$ LANGUAGE plpgsql;

CREATE TRIGGER "events_no_update_delete"
  BEFORE UPDATE OR DELETE ON "audit"."events"
  FOR EACH ROW EXECUTE FUNCTION "audit"."block_change"();

CREATE TRIGGER "events_no_truncate"
  BEFORE TRUNCATE ON "audit"."events"
  FOR EACH STATEMENT EXECUTE FUNCTION "audit"."block_change"();

CREATE TRIGGER "checkpoints_no_update_delete"
  BEFORE UPDATE OR DELETE ON "audit"."checkpoints"
  FOR EACH ROW EXECUTE FUNCTION "audit"."block_change"();

CREATE TRIGGER "checkpoints_no_truncate"
  BEFORE TRUNCATE ON "audit"."checkpoints"
  FOR EACH STATEMENT EXECUTE FUNCTION "audit"."block_change"();
