import {
  AddressReference,
  CompiledStep,
  compileStep,
  EMPTY_ADDRESS_REFERENCE,
  runChain,
} from '../transforms';
import {
  compileRule,
  ROW_FIELDS,
  RowField,
  rowSchema,
  Rule,
  RuleContext,
  TARGET_FIELDS,
} from '../validation';
import type { MappingSpec } from './mapping-spec';

/** A problem with one field of one row. Every problem is kept, not just the first. */
export type FieldIssue = {
  field: RowField;
  stage: 'transform' | 'validate';
  message: string;
};

export type NormalizedRow = Record<RowField, string | null>;

export type MappedRow = {
  values: NormalizedRow;
  warnings: FieldIssue[];
  errors: FieldIssue[];
  status: 'valid' | 'quarantined';
};

type CompiledField = {
  field: RowField;
  from: string[];
  steps: CompiledStep[];
  rules: { spec: string; check: Rule }[];
  onError: 'quarantine' | 'null';
};

export type CompiledMapping = { fields: CompiledField[]; columns: string[] };

/**
 * Prepares a validated spec for fast repeated use, bound to the address reference data that
 * the crosswalk transform and ward rule look up. Throws only on an unvalidated spec.
 */
export function compileMapping(
  spec: MappingSpec,
  ref: AddressReference = EMPTY_ADDRESS_REFERENCE,
): CompiledMapping {
  const fields = spec.fields.map((f): CompiledField => {
    const steps = f.transforms.map((step) => {
      const compiled = compileStep(step, ref);
      if ('error' in compiled) throw new Error(compiled.error);
      return compiled;
    });
    const rules = f.rules.map((spec) => {
      const check = compileRule(spec, ref);
      if (typeof check !== 'function') throw new Error(check.error);
      return { spec, check };
    });
    return { field: TARGET_FIELDS[f.target]!, from: f.from, steps, rules, onError: f.onError };
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
  const values = Object.fromEntries(ROW_FIELDS.map((f) => [f, null])) as NormalizedRow;
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
 * Validate stage: field rules, then the row schema (required fields, enums, date format, a
 * complete household address). Fields in `skip` already failed to transform and are not
 * reported twice.
 */
export function validateRow(
  values: NormalizedRow,
  mapping: CompiledMapping,
  ctx: RuleContext,
  skip: ReadonlySet<RowField> = new Set(),
): FieldIssue[] {
  const errors: FieldIssue[] = [];
  for (const f of mapping.fields) {
    if (skip.has(f.field)) continue;
    for (const rule of f.rules) {
      const message = rule.check(values[f.field], ctx, values);
      if (message) {
        errors.push({ field: f.field, stage: 'validate', message: `${rule.spec}: ${message}` });
      }
    }
  }

  const flagged = new Set([...skip, ...errors.map((e) => e.field)]);
  const shape = rowSchema.safeParse(values);
  if (!shape.success) {
    for (const issue of shape.error.issues) {
      const field = issue.path[0] as RowField;
      if (!flagged.has(field)) {
        errors.push({ field, stage: 'validate', message: issue.message });
        flagged.add(field);
      }
    }
  }
  return errors;
}
