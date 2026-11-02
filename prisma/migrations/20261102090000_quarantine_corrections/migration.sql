-- An operator's correction of a quarantined row's legacy values, kept beside the untouched
-- raw row; retry runs the row through the run's mapping again with these values.
ALTER TABLE "staging"."quarantine" ADD COLUMN "corrected" JSONB,
ADD COLUMN "corrected_by" UUID,
ADD COLUMN "corrected_at" TIMESTAMPTZ(3);
