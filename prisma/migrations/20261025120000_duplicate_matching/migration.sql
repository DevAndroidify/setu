-- The match stage runs between validate and load.
ALTER TYPE "control"."BatchStage" ADD VALUE 'match' AFTER 'validate';

-- A row the matcher (or a reviewer) linked to a person already in target.
ALTER TYPE "staging"."StagedStatus" ADD VALUE 'linked';

-- Blocking key (district | birth year): rows are only compared within their block.
ALTER TABLE "staging"."staged_rows" ADD COLUMN "block_key" TEXT;
CREATE INDEX "staged_rows_block_key_idx" ON "staging"."staged_rows"("block_key");

-- Rows sharing a citizenship number are always compared, whatever their block.
CREATE INDEX "staged_rows_citizenship_no_idx" ON "staging"."staged_rows"((normalized->>'citizenship_no'));
