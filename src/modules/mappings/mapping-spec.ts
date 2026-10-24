import { z } from 'zod';
import { compileStep } from '../transforms';
import { compileRule, PERSON_FIELDS } from '../validation';

const TARGETS = PERSON_FIELDS.map((f) => `person.${f}` as const);
const REQUIRED_TARGETS = ['person.name_ne', 'person.name_en'];

const fieldSchema = z
  .object({
    /** Target column, e.g. "person.dob_ad". */
    target: z.enum(TARGETS as [string, ...string[]]),
    /** Source columns; several are joined with a space (e.g. first and last name). */
    from: z.array(z.string().min(1)).min(1),
    transforms: z
      .array(z.object({ name: z.string().min(1), args: z.unknown().optional() }).strict())
      .default([]),
    rules: z.array(z.string().min(1)).default([]),
    /** quarantine: a failed transform sends the row to quarantine; null: keep the row, empty field. */
    onError: z.enum(['quarantine', 'null']).default('quarantine'),
  })
  .strict();

/**
 * A declarative mapping from one legacy source to target persons. Saved as a new version on
 * every edit; a run pins one version.
 */
export const mappingSpecSchema = z
  .object({ fields: z.array(fieldSchema).min(1) })
  .strict()
  .superRefine((spec, ctx) => {
    const seen = new Set<string>();
    spec.fields.forEach((field, i) => {
      if (seen.has(field.target)) {
        ctx.addIssue({ code: 'custom', path: ['fields', i, 'target'], message: 'is mapped twice' });
      }
      seen.add(field.target);
      field.transforms.forEach((step, j) => {
        const compiled = compileStep(step);
        if ('error' in compiled) {
          ctx.addIssue({
            code: 'custom',
            path: ['fields', i, 'transforms', j],
            message: compiled.error,
          });
        }
      });
      field.rules.forEach((rule, j) => {
        const compiled = compileRule(rule);
        if (typeof compiled !== 'function') {
          ctx.addIssue({
            code: 'custom',
            path: ['fields', i, 'rules', j],
            message: compiled.error,
          });
        }
      });
    });
    for (const target of REQUIRED_TARGETS) {
      if (!seen.has(target)) {
        ctx.addIssue({ code: 'custom', path: ['fields'], message: `${target} must be mapped` });
      }
    }
  });

export type MappingSpec = z.infer<typeof mappingSpecSchema>;
