import { CompiledStep, compileStep, runChain } from '../transforms';
import {
  compileRule,
  PERSON_FIELDS,
  PersonField,
  personSchema,
  Rule,
  RuleContext,
} from '../validation';
import type { MappingSpec } from './mapping-spec';

/** A problem with one field of one row. Every problem is kept, not just the first. */
export type FieldIssue = {
  field: PersonField;
  stage: 'transform' | 'validate';
  message: string;
};

export type MappedRow = {
  values: Record<PersonField, string | null>;
  warnings: FieldIssue[];
  errors: FieldIssue[];
  status: 'valid' | 'quarantined';
};

type CompiledField = {
  field: PersonField;
  from: string[];
  steps: CompiledStep[];
  rules: { spec: string; check: Rule }[];
  onError: 'quarantine' | 'null';
};

export type CompiledMapping = { fields: CompiledField[]; columns: string[] };

/** Prepares a validated spec for fast repeated use. Throws only on an unvalidated spec. */
export function compileMapping(spec: MappingSpec): CompiledMapping {
  const fields = spec.fields.map((f): CompiledField => {
    const steps = f.transforms.map((step) => {
      const compiled = compileStep(step);
      if ('error' in compiled) throw new Error(compiled.error);
      return compiled;
    });
    const rules = f.rules.map((spec) => {
      const check = compileRule(spec);
      if (typeof check !== 'function') throw new Error(check.error);
      return { spec, check };
    });
    return {
      field: f.target.replace(/^person\./, '') as PersonField,
      from: f.from,
      steps,
      rules,
      onError: f.onError,
    };
  });
  return { fields, columns: [...new Set(fields.flatMap((f) => f.from))] };
}

/** Pure: turns one legacy row into a normalized person plus every warning and error. */
export function mapRow(
  raw: Record<string, string>,
  mapping: CompiledMapping,
  ctx: RuleContext,
): MappedRow {
  const values = Object.fromEntries(PERSON_FIELDS.map((f) => [f, null])) as Record<
    PersonField,
    string | null
  >;
  const warnings: FieldIssue[] = [];
  const errors: FieldIssue[] = [];

  for (const f of mapping.fields) {
    const input = f.from
      .map((column) => (raw[column] ?? '').trim())
      .filter(Boolean)
      .join(' ');
    const result = runChain(input, f.steps);
    if (!result.ok) {
      const issue = { field: f.field, stage: 'transform' as const, message: result.error };
      (f.onError === 'null' ? warnings : errors).push(issue);
      continue;
    }
    values[f.field] = result.value === '' ? null : result.value;
    warnings.push(
      ...result.warnings.map((message) => ({
        field: f.field,
        stage: 'transform' as const,
        message,
      })),
    );
    for (const rule of f.rules) {
      const message = rule.check(values[f.field], ctx);
      if (message)
        errors.push({ field: f.field, stage: 'validate', message: `${rule.spec}: ${message}` });
    }
  }

  // Entity-level shape (required fields, enums, date format) for fields not already flagged.
  const flagged = new Set(errors.map((e) => e.field));
  const shape = personSchema.safeParse(values);
  if (!shape.success) {
    for (const issue of shape.error.issues) {
      const field = issue.path[0] as PersonField;
      if (!flagged.has(field)) {
        errors.push({ field, stage: 'validate', message: issue.message });
        flagged.add(field);
      }
    }
  }

  return { values, warnings, errors, status: errors.length ? 'quarantined' : 'valid' };
}
