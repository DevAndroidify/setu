import { z } from 'zod';

/** Fields of target.persons a mapping can fill. */
export const PERSON_FIELDS = [
  'name_ne',
  'name_en',
  'gender',
  'dob_ad',
  'citizenship_no',
  'father_name_ne',
] as const;
export type PersonField = (typeof PERSON_FIELDS)[number];

/** Fields of the person's household (target.households) a mapping can fill. */
export const HOUSEHOLD_FIELDS = ['household_no', 'local_unit_code', 'ward_no', 'tole'] as const;
export type HouseholdField = (typeof HOUSEHOLD_FIELDS)[number];

/** Every normalized field of a row: the person and, optionally, their household. */
export const ROW_FIELDS = [...PERSON_FIELDS, ...HOUSEHOLD_FIELDS] as const;
export type RowField = (typeof ROW_FIELDS)[number];

/** Mapping spec target -> normalized field, e.g. "household.no" -> "household_no". */
export const TARGET_FIELDS: Record<string, RowField> = {
  ...Object.fromEntries(PERSON_FIELDS.map((f) => [`person.${f}`, f])),
  'household.no': 'household_no',
  'household.local_unit_code': 'local_unit_code',
  'household.ward_no': 'ward_no',
  'household.tole': 'tole',
};

/** Shape every normalized person must have before it can be loaded. */
export const personSchema = z.object({
  name_ne: z.string().min(1, 'is required'),
  name_en: z.string().min(1, 'is required'),
  gender: z.enum(['male', 'female', 'other']).nullable(),
  dob_ad: z.iso.date('is not an AD date (YYYY-MM-DD)').nullable(),
  citizenship_no: z.string().nullable(),
  father_name_ne: z.string().nullable(),
});

export type NormalizedPerson = z.infer<typeof personSchema>;

/**
 * A whole row: the person, plus a household address that is either absent or complete. A
 * household number without a local unit and ward cannot be loaded.
 */
export const rowSchema = personSchema
  .extend({
    household_no: z.string().nullable(),
    local_unit_code: z.string().nullable(),
    ward_no: z.string().regex(/^\d+$/, 'is not a ward number').nullable(),
    tole: z.string().nullable(),
  })
  .superRefine((row, ctx) => {
    if (row.household_no === null) return;
    for (const field of ['local_unit_code', 'ward_no'] as const) {
      if (row[field] === null) {
        ctx.addIssue({ code: 'custom', path: [field], message: 'is required for a household' });
      }
    }
  });
