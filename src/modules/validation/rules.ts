import { AddressReference, EMPTY_ADDRESS_REFERENCE } from '../transforms';

/**
 * Business rules a mapping can attach to a field, written as "name" or "name:param"
 * (e.g. "after:1940-01-01"). Pure: anything a rule needs from outside comes in RuleContext.
 */

export type RuleContext = {
  /** Today's date in Nepal, as AD YYYY-MM-DD. Passed in so rules stay pure and testable. */
  today: string;
};

/** The row's other normalized values, for rules that compare fields (e.g. ward and unit). */
export type RowValues = Readonly<Record<string, string | null>>;

/** Returns a message describing the problem, or null when the value passes. */
export type Rule = (value: string | null, ctx: RuleContext, row?: RowValues) => string | null;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
// District-office format, e.g. 27-01-71-12345. Messages never echo the number itself.
const CITIZENSHIP_NO = /^\d{1,2}-\d{1,2}-\d{1,2}-\d{1,6}$/;

type RuleFactory = (param: string | undefined, ref: AddressReference) => Rule | { error: string };

const toInt = (v: string): number | null => (/^\d+$/.test(v) ? Number(v) : null);

const RULES: Record<string, RuleFactory> = {
  required: () => (v) => (v === null || v === '' ? 'is required' : null),

  notFuture: () => (v, ctx) => (v !== null && v > ctx.today ? `${v} is in the future` : null),

  after: (param) => {
    if (!param || !ISO_DATE.test(param)) return { error: 'after needs a date: after:YYYY-MM-DD' };
    return (v) => (v !== null && v < param ? `${v} is before ${param}` : null);
  },

  citizenshipFormat: () => (v) =>
    v !== null && !CITIZENSHIP_NO.test(v)
      ? 'is not a valid citizenship number (expected NN-NN-NN-NNNNN)'
      : null,

  maxLength: (param) => {
    const max = Number(param);
    if (!Number.isInteger(max) || max < 1)
      return { error: 'maxLength needs a number: maxLength:100' };
    return (v) => (v !== null && v.length > max ? `is longer than ${max} characters` : null);
  },

  max: (param) => {
    const max = Number(param);
    if (!Number.isInteger(max)) return { error: 'max needs a whole number: max:9' };
    return (v) => {
      if (v === null) return null;
      const n = toInt(v);
      return n !== null && n > max ? `${n} is more than ${max}` : null; // non-numbers: schema
    };
  },

  /** The ward must exist in the row's local unit (household.local_unit_code). */
  wardInUnit: (_, ref) => (v, _ctx, row) => {
    if (v === null) return null;
    const ward = toInt(v);
    if (ward === null) return null; // reported once, by the row schema
    if (ward < 1) return 'ward numbers start at 1';
    const unit = row?.local_unit_code;
    if (!unit) return null; // the address itself failed and is reported there
    const count = ref.wardCounts.get(unit);
    if (count === undefined) return `local unit ${unit} is not in the reference data`;
    return ward > count ? `ward ${ward} exceeds the ${count} wards of ${unit}` : null;
  },
};

export const RULE_NAMES = Object.keys(RULES);

export function compileRule(
  spec: string,
  ref: AddressReference = EMPTY_ADDRESS_REFERENCE,
): Rule | { error: string } {
  const [name, ...rest] = spec.split(':');
  const factory = name ? RULES[name] : undefined;
  if (!factory) return { error: `unknown rule "${spec}"` };
  return factory(rest.length ? rest.join(':') : undefined, ref);
}

/** Today's date in Nepal (UTC+05:45) as YYYY-MM-DD, whatever the server's time zone. */
export function todayInNepal(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kathmandu' }).format(now);
}
