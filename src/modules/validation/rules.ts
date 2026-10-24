/**
 * Business rules a mapping can attach to a field, written as "name" or "name:param"
 * (e.g. "after:1940-01-01"). Pure: anything a rule needs from outside comes in RuleContext.
 */

export type RuleContext = {
  /** Today's date in Nepal, as AD YYYY-MM-DD. Passed in so rules stay pure and testable. */
  today: string;
};

/** Returns a message describing the problem, or null when the value passes. */
export type Rule = (value: string | null, ctx: RuleContext) => string | null;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
// District-office format, e.g. 27-01-71-12345. Messages never echo the number itself.
const CITIZENSHIP_NO = /^\d{1,2}-\d{1,2}-\d{1,2}-\d{1,6}$/;

type RuleFactory = (param: string | undefined) => Rule | { error: string };

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
};

export const RULE_NAMES = Object.keys(RULES);

export function compileRule(spec: string): Rule | { error: string } {
  const [name, ...rest] = spec.split(':');
  const factory = name ? RULES[name] : undefined;
  if (!factory) return { error: `unknown rule "${spec}"` };
  return factory(rest.length ? rest.join(':') : undefined);
}

/** Today's date in Nepal (UTC+05:45) as YYYY-MM-DD, whatever the server's time zone. */
export function todayInNepal(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kathmandu' }).format(now);
}
