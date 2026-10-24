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
  const transformed = transformRow(raw, mapping);
  const failed = new Set(transformed.errors.map((e) => e.field));
  const errors = [...transformed.errors, ...validateRow(transformed.values, mapping, ctx, failed)];
  return { ...transformed, errors, status: errors.length ? 'quarantined' : 'valid' };
}

export type TransformedRow = Pick<MappedRow, 'values' | 'warnings' | 'errors'>;

/** Transform stage: runs each field's transform chain. Errors here are transform failures. */
export function transformRow(
  raw: Record<string, string>,
  mapping: CompiledMapping,
): TransformedRow {
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
    for (const message of result.warnings) {
      warnings.push({ field: f.field, stage: 'transform', message });
    }
  }
  return { values, warnings, errors };
}

/**
 * Validate stage: field rules, then the entity schema (required fields, enums, date format).
 * Fields in `skip` already failed to transform and are not reported twice.
 */
export function validateRow(
  values: Record<PersonField, string | null>,
  mapping: CompiledMapping,
  ctx: RuleContext,
  skip: ReadonlySet<PersonField> = new Set(),
): FieldIssue[] {
  const errors: FieldIssue[] = [];
  for (const f of mapping.fields) {
    if (skip.has(f.field)) continue;
    for (const rule of f.rules) {
      const message = rule.check(values[f.field], ctx);
      if (message) {
        errors.push({ field: f.field, stage: 'validate', message: `${rule.spec}: ${message}` });
      }
    }
  }

  const flagged = new Set([...skip, ...errors.map((e) => e.field)]);
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
  return errors;
}
