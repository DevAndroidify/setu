-- Duplicate blocks are now district + exact date of birth (they were district + birth year):
-- rewrite the keys of rows already matched, so new rows still find them (docs/adr/0006).
UPDATE staging.staged_rows s
SET block_key = coalesce(u.district_code, '?') || '|' || (s.normalized->>'dob_ad')
FROM staging.staged_rows s2
LEFT JOIN target.local_units u ON u.code = s2.normalized->>'local_unit_code'
WHERE s2.id = s.id AND s.block_key IS NOT NULL;
