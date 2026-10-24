-- CreateEnum
CREATE TYPE "control"."BatchStage" AS ENUM ('extract', 'transform', 'validate', 'load', 'done');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "control"."RunStatus" ADD VALUE 'paused';
ALTER TYPE "control"."RunStatus" ADD VALUE 'cancelled';

-- DropIndex
DROP INDEX "staging"."quarantine_staged_row_id_idx";

-- AlterTable
ALTER TABLE "control"."batches" ADD COLUMN     "stage" "control"."BatchStage" NOT NULL DEFAULT 'extract';

-- CreateIndex
CREATE UNIQUE INDEX "quarantine_staged_row_id_stage_key" ON "staging"."quarantine"("staged_row_id", "stage");

