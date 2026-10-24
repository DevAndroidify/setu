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
