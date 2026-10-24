-- Added by hand: the trigram index on target.persons below needs this extension.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "audit";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "control";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "staging";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "target";

-- CreateEnum
CREATE TYPE "control"."Role" AS ENUM ('operator', 'reviewer', 'approver', 'auditor', 'admin');

-- CreateEnum
CREATE TYPE "control"."SourceKind" AS ENUM ('csv', 'excel', 'xml', 'sql');

-- CreateEnum
CREATE TYPE "control"."RunMode" AS ENUM ('dry_run', 'production');

-- CreateEnum
CREATE TYPE "control"."RunStatus" AS ENUM ('draft', 'awaiting_approval', 'queued', 'running', 'completed', 'failed', 'rolled_back');

-- CreateEnum
CREATE TYPE "control"."BatchStatus" AS ENUM ('pending', 'running', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "control"."ApprovalDecision" AS ENUM ('approved', 'rejected');

-- CreateEnum
CREATE TYPE "staging"."StagedStatus" AS ENUM ('valid', 'quarantined', 'duplicate_review', 'loaded');

-- CreateEnum
CREATE TYPE "staging"."MatchDecision" AS ENUM ('pending', 'link', 'not_same');

-- CreateEnum
CREATE TYPE "target"."Gender" AS ENUM ('male', 'female', 'other');

-- CreateTable
CREATE TABLE "control"."users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "control"."Role" NOT NULL,
    "failed_logins" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control"."refresh_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control"."sources" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "kind" "control"."SourceKind" NOT NULL,
    "agency" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control"."source_files" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source_id" UUID NOT NULL,
    "filename" TEXT NOT NULL,
    "object_key" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "encoding" TEXT,
    "row_count" INTEGER,
    "uploaded_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control"."profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source_file_id" UUID NOT NULL,
    "report" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control"."mappings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "spec" JSONB NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control"."runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source_file_id" UUID NOT NULL,
    "mapping_id" UUID NOT NULL,
    "mode" "control"."RunMode" NOT NULL,
    "status" "control"."RunStatus" NOT NULL DEFAULT 'draft',
    "counts" JSONB NOT NULL DEFAULT '{}',
    "created_by" UUID NOT NULL,
    "approved_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),

    CONSTRAINT "runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control"."batches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "run_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "row_from" INTEGER NOT NULL,
    "row_to" INTEGER NOT NULL,
    "status" "control"."BatchStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "heartbeat_at" TIMESTAMPTZ(3),

    CONSTRAINT "batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control"."approvals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "run_id" UUID NOT NULL,
    "requested_by" UUID NOT NULL,
    "decided_by" UUID,
    "decision" "control"."ApprovalDecision",
    "reason" TEXT,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMPTZ(3),

    CONSTRAINT "approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staging"."raw_rows" (
    "id" BIGSERIAL NOT NULL,
    "run_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "row_no" INTEGER NOT NULL,
    "raw" JSONB NOT NULL,
    "row_hash" TEXT NOT NULL,

    CONSTRAINT "raw_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staging"."staged_rows" (
    "id" BIGSERIAL NOT NULL,
    "raw_row_id" BIGINT NOT NULL,
    "normalized" JSONB NOT NULL,
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "status" "staging"."StagedStatus" NOT NULL,

    CONSTRAINT "staged_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staging"."quarantine" (
    "id" BIGSERIAL NOT NULL,
    "staged_row_id" BIGINT NOT NULL,
    "stage" TEXT NOT NULL,
    "reasons" JSONB NOT NULL,
    "resolved_by" UUID,
    "resolved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quarantine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staging"."match_candidates" (
    "id" BIGSERIAL NOT NULL,
    "row_a" BIGINT NOT NULL,
    "row_b" BIGINT NOT NULL,
    "score" DECIMAL(4,3) NOT NULL,
    "features" JSONB NOT NULL,
    "decision" "staging"."MatchDecision" NOT NULL DEFAULT 'pending',
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(3),

    CONSTRAINT "match_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "target"."local_units" (
    "code" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ne" TEXT NOT NULL,
    "district_code" TEXT NOT NULL,
    "province" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "ward_count" INTEGER NOT NULL,

    CONSTRAINT "local_units_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "target"."legacy_vdcs" (
    "id" SERIAL NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ne" TEXT NOT NULL,
    "district_code" TEXT NOT NULL,
    "local_unit_code" TEXT,

    CONSTRAINT "legacy_vdcs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "target"."households" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "local_unit_code" TEXT NOT NULL,
    "ward_no" INTEGER NOT NULL,
    "tole" TEXT,
    "head_person_id" UUID,
    "created_by_run" UUID,

    CONSTRAINT "households_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "target"."persons" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "household_id" UUID,
    "name_ne" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "gender" "target"."Gender",
    "dob_ad" DATE,
    "citizenship_no" TEXT,
    "father_name_ne" TEXT,
    "created_by_run" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "persons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "target"."lineage" (
    "target_table" TEXT NOT NULL,
    "target_id" UUID NOT NULL,
    "raw_row_id" BIGINT NOT NULL,
    "mapping_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,

    CONSTRAINT "lineage_pkey" PRIMARY KEY ("target_table","target_id","raw_row_id")
);

-- CreateTable
CREATE TABLE "audit"."events" (
    "stream" TEXT NOT NULL,
    "seq" BIGINT NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT,
    "payload" JSONB NOT NULL,
    "reason" TEXT,
    "prev_hash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("stream","seq")
);

-- CreateTable
CREATE TABLE "audit"."checkpoints" (
    "stream" TEXT NOT NULL,
    "seq" BIGINT NOT NULL,
    "hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checkpoints_pkey" PRIMARY KEY ("stream","seq")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "control"."users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "control"."refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "control"."refresh_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "source_files_sha256_key" ON "control"."source_files"("sha256");

-- CreateIndex
CREATE INDEX "source_files_source_id_idx" ON "control"."source_files"("source_id");

-- CreateIndex
CREATE UNIQUE INDEX "profiles_source_file_id_key" ON "control"."profiles"("source_file_id");

-- CreateIndex
CREATE UNIQUE INDEX "mappings_source_id_version_key" ON "control"."mappings"("source_id", "version");

-- CreateIndex
CREATE INDEX "runs_status_idx" ON "control"."runs"("status");

-- CreateIndex
CREATE UNIQUE INDEX "batches_run_id_seq_key" ON "control"."batches"("run_id", "seq");

-- CreateIndex
CREATE INDEX "approvals_run_id_idx" ON "control"."approvals"("run_id");

-- CreateIndex
CREATE INDEX "raw_rows_batch_id_idx" ON "staging"."raw_rows"("batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "raw_rows_run_id_row_no_key" ON "staging"."raw_rows"("run_id", "row_no");

-- CreateIndex
CREATE UNIQUE INDEX "staged_rows_raw_row_id_key" ON "staging"."staged_rows"("raw_row_id");

-- CreateIndex
CREATE INDEX "staged_rows_status_idx" ON "staging"."staged_rows"("status");

-- CreateIndex
CREATE INDEX "quarantine_staged_row_id_idx" ON "staging"."quarantine"("staged_row_id");

-- CreateIndex
CREATE INDEX "match_candidates_decision_idx" ON "staging"."match_candidates"("decision");

-- CreateIndex
CREATE UNIQUE INDEX "match_candidates_row_a_row_b_key" ON "staging"."match_candidates"("row_a", "row_b");

-- CreateIndex
CREATE INDEX "legacy_vdcs_district_code_name_en_idx" ON "target"."legacy_vdcs"("district_code", "name_en");

-- CreateIndex
CREATE UNIQUE INDEX "households_head_person_id_key" ON "target"."households"("head_person_id");

-- CreateIndex
CREATE UNIQUE INDEX "persons_citizenship_no_key" ON "target"."persons"("citizenship_no");

-- CreateIndex
CREATE INDEX "persons_household_id_idx" ON "target"."persons"("household_id");

-- CreateIndex
CREATE INDEX "persons_name_en_trgm" ON "target"."persons" USING GIN ("name_en" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "lineage_run_id_idx" ON "target"."lineage"("run_id");

-- CreateIndex
CREATE INDEX "lineage_raw_row_id_idx" ON "target"."lineage"("raw_row_id");

-- CreateIndex
CREATE INDEX "events_entity_entity_id_idx" ON "audit"."events"("entity", "entity_id");

-- CreateIndex
CREATE INDEX "events_occurred_at_idx" ON "audit"."events"("occurred_at");

-- AddForeignKey
ALTER TABLE "control"."refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "control"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control"."sources" ADD CONSTRAINT "sources_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "control"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control"."source_files" ADD CONSTRAINT "source_files_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "control"."sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control"."source_files" ADD CONSTRAINT "source_files_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "control"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control"."profiles" ADD CONSTRAINT "profiles_source_file_id_fkey" FOREIGN KEY ("source_file_id") REFERENCES "control"."source_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control"."mappings" ADD CONSTRAINT "mappings_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "control"."sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control"."mappings" ADD CONSTRAINT "mappings_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "control"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control"."runs" ADD CONSTRAINT "runs_source_file_id_fkey" FOREIGN KEY ("source_file_id") REFERENCES "control"."source_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control"."runs" ADD CONSTRAINT "runs_mapping_id_fkey" FOREIGN KEY ("mapping_id") REFERENCES "control"."mappings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control"."runs" ADD CONSTRAINT "runs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "control"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control"."runs" ADD CONSTRAINT "runs_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "control"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control"."batches" ADD CONSTRAINT "batches_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "control"."runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control"."approvals" ADD CONSTRAINT "approvals_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "control"."runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control"."approvals" ADD CONSTRAINT "approvals_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "control"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control"."approvals" ADD CONSTRAINT "approvals_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "control"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staging"."raw_rows" ADD CONSTRAINT "raw_rows_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "control"."runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staging"."raw_rows" ADD CONSTRAINT "raw_rows_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "control"."batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staging"."staged_rows" ADD CONSTRAINT "staged_rows_raw_row_id_fkey" FOREIGN KEY ("raw_row_id") REFERENCES "staging"."raw_rows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staging"."quarantine" ADD CONSTRAINT "quarantine_staged_row_id_fkey" FOREIGN KEY ("staged_row_id") REFERENCES "staging"."staged_rows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staging"."match_candidates" ADD CONSTRAINT "match_candidates_row_a_fkey" FOREIGN KEY ("row_a") REFERENCES "staging"."staged_rows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staging"."match_candidates" ADD CONSTRAINT "match_candidates_row_b_fkey" FOREIGN KEY ("row_b") REFERENCES "staging"."staged_rows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "target"."legacy_vdcs" ADD CONSTRAINT "legacy_vdcs_local_unit_code_fkey" FOREIGN KEY ("local_unit_code") REFERENCES "target"."local_units"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "target"."households" ADD CONSTRAINT "households_local_unit_code_fkey" FOREIGN KEY ("local_unit_code") REFERENCES "target"."local_units"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "target"."households" ADD CONSTRAINT "households_head_person_id_fkey" FOREIGN KEY ("head_person_id") REFERENCES "target"."persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "target"."persons" ADD CONSTRAINT "persons_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "target"."households"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "target"."lineage" ADD CONSTRAINT "lineage_raw_row_id_fkey" FOREIGN KEY ("raw_row_id") REFERENCES "staging"."raw_rows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "target"."lineage" ADD CONSTRAINT "lineage_mapping_id_fkey" FOREIGN KEY ("mapping_id") REFERENCES "control"."mappings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "target"."lineage" ADD CONSTRAINT "lineage_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "control"."runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "target"."lineage" ADD CONSTRAINT "lineage_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "control"."batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
