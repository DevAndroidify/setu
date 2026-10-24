-- One crosswalk entry per VDC name within a district, so reference data loads idempotently.
DROP INDEX "target"."legacy_vdcs_district_code_name_en_idx";
CREATE UNIQUE INDEX "legacy_vdcs_district_code_name_en_key" ON "target"."legacy_vdcs"("district_code", "name_en");

-- Wards are numbered from 1; the upper bound depends on the local unit and is checked in validation.
ALTER TABLE "target"."households" ADD CONSTRAINT "households_ward_no_check" CHECK (ward_no >= 1);
ALTER TABLE "target"."local_units" ADD CONSTRAINT "local_units_ward_count_check" CHECK (ward_count >= 1);
