import { z } from 'zod';
import { bsToAd, DEFAULT_BS_FORMATS, fiscalYear } from './bs-date';
import { devanagariDigits } from './digits';
import { preetiToUnicode } from './preeti';
import { namePart, titleCase, trim } from './text';
import { ok, TransformResult } from './transform-result';
import { mapValues } from './values';

type TransformFn = (input: string) => TransformResult<string>;

type Definition = {
  /** Validates the step's args as written in a mapping spec. */
  args: z.ZodType;
  /** Binds validated args to the transform. */
  bind: (args: never) => TransformFn;
};

const define = <A>(args: z.ZodType<A>, bind: (args: A) => TransformFn): Definition => ({
  args,
  bind: bind as (args: never) => TransformFn,
});

const noArgs = z.object({}).strict().optional();
const dateArgs = z
  .object({ formats: z.array(z.string().min(1)).min(1).default(DEFAULT_BS_FORMATS) })
  .strict()
  .default({ formats: DEFAULT_BS_FORMATS });

/** Every transform a mapping spec may name, with the args it accepts. */
export const TRANSFORMS = {
  trim: define(noArgs, () => trim),
  titleCase: define(noArgs, () => titleCase),
  devanagariDigits: define(noArgs, () => devanagariDigits),
  preetiToUnicode: define(noArgs, () => preetiToUnicode),
  bsToAd: define(dateArgs, (args) => (v) => bsToAd(v, args)),
  fiscalYear: define(dateArgs, (args) => (v) => fiscalYear(v, args)),
  namePart: define(
    z.object({ part: z.enum(['first', 'middle', 'last']) }).strict(),
    (args) => (v) => namePart(v, args),
  ),
  mapValues: define(
    z
      .object({
        values: z
          .record(z.string(), z.string())
          .refine((r) => Object.keys(r).length > 0, 'must not be empty'),
        caseInsensitive: z.boolean().default(true),
      })
      .strict(),
    (args) => (v) => mapValues(v, args),
  ),
} satisfies Record<string, Definition>;

export type TransformName = keyof typeof TRANSFORMS;
export type TransformStep = { name: string; args?: unknown };
export type CompiledStep = { name: string; run: TransformFn };

/** Checks a step's name and args; returns the ready-to-run step or why it is invalid. */
export function compileStep(step: TransformStep): CompiledStep | { error: string } {
  const definition = (TRANSFORMS as Record<string, Definition>)[step.name];
  if (!definition) return { error: `unknown transform "${step.name}"` };
  const args = definition.args.safeParse(step.args);
  if (!args.success) {
    const why = args.error.issues.map((i) => `${i.path.join('.') || 'args'} ${i.message}`);
    return { error: `invalid args for ${step.name}: ${why.join('; ')}` };
  }
  return { name: step.name, run: definition.bind(args.data as never) };
}

/** Runs steps in order, collecting warnings; stops at the first step that fails. */
export function runChain(input: string, steps: CompiledStep[]): TransformResult<string> {
  let value = input;
  const warnings: string[] = [];
  for (const step of steps) {
    const result = step.run(value);
    if (!result.ok) return { ok: false, error: `${step.name}: ${result.error}` };
    value = result.value;
    warnings.push(...result.warnings.map((w) => `${step.name}: ${w}`));
  }
  return ok(value, warnings);
}
