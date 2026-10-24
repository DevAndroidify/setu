import DateConverter from '@remotemerge/nepali-date-converter';
import { fail, ok, TransformResult } from './transform-result';

/** The converter's table covers these BS years; anything outside cannot be converted. */
export const BS_MIN_YEAR = 1975;
export const BS_MAX_YEAR = 2099;
/** BS years this early are rare for living people and often an AD year typed by mistake. */
const SUSPICIOUS_BS_YEAR = 2000;

export const DEFAULT_BS_FORMATS = ['YYYY/M/D', 'YYYY-MM-DD', 'D/M/YYYY', 'YYYY.MM.DD'];

type Ymd = { y: number; m: number; d: number };

const TOKENS: Record<string, string> = {
  YYYY: '(?<y>\\d{4})',
  MM: '(?<m>\\d{2})',
  M: '(?<m>\\d{1,2})',
  DD: '(?<d>\\d{2})',
  D: '(?<d>\\d{1,2})',
};

function compile(format: string): RegExp {
  const pattern = format.replace(
    /YYYY|MM|M|DD|D|[^YMD]/g,
    (token) => TOKENS[token] ?? token.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'),
  );
  return new RegExp(`^${pattern}$`);
}

function parse(text: string, formats: string[]): Ymd | undefined {
  for (const format of formats) {
    const groups = compile(format).exec(text)?.groups;
    if (groups) return { y: Number(groups.y), m: Number(groups.m), d: Number(groups.d) };
  }
  return undefined;
}

const pad = (n: number): string => String(n).padStart(2, '0');
const iso = ({ y, m, d }: Ymd): string => `${y}-${pad(m)}-${pad(d)}`;

/** Converts a validated BS date to AD, or explains why it cannot. */
function convert(date: Ymd): TransformResult<string> {
  if (date.y < BS_MIN_YEAR || date.y > BS_MAX_YEAR) {
    const hint = date.y < BS_MIN_YEAR ? '; it may be an AD date' : '';
    return fail(
      `year ${date.y} is outside the supported BS range ${BS_MIN_YEAR}-${BS_MAX_YEAR}${hint}`,
    );
  }
  try {
    const ad = new DateConverter(iso(date)).toAd();
    const warnings =
      date.y < SUSPICIOUS_BS_YEAR
        ? [`BS year ${date.y} is unusually early; check it is not an AD date`]
        : [];
    return ok(iso({ y: ad.year, m: ad.month, d: ad.date }), warnings);
  } catch {
    return fail(`${iso(date)} is not a real BS date`);
  }
}

/**
 * Parses a BS date in one of the given formats and returns the AD date as YYYY-MM-DD.
 * Run devanagariDigits first if the source may contain Devanagari digits.
 */
export function bsToAd(input: string, args: { formats?: string[] } = {}): TransformResult<string> {
  const text = input.trim();
  if (text === '') return ok('');
  const formats = args.formats ?? DEFAULT_BS_FORMATS;
  const date = parse(text, formats);
  if (!date) return fail(`"${text}" matches none of the date formats ${formats.join(', ')}`);
  return convert(date);
}

/** Converts an AD date (YYYY-MM-DD) to BS (YYYY-MM-DD), used at the API edge for display. */
export function adToBs(input: string): TransformResult<string> {
  const date = parse(input.trim(), ['YYYY-MM-DD']);
  if (!date) return fail(`"${input}" is not an AD date in YYYY-MM-DD format`);
  try {
    const bs = new DateConverter(iso(date)).toBs();
    return ok(iso({ y: bs.year, m: bs.month, d: bs.date }));
  } catch {
    return fail(`${iso(date)} is not a real AD date or is outside the supported range`);
  }
}

/** Nepal's fiscal year starts on 1 Shrawan (month 4): 2080-04-01 BS is in fiscal year 2080/81. */
export function fiscalYear(
  input: string,
  args: { formats?: string[] } = {},
): TransformResult<string> {
  const text = input.trim();
  if (text === '') return ok('');
  const formats = args.formats ?? DEFAULT_BS_FORMATS;
  const date = parse(text, formats);
  if (!date) return fail(`"${text}" matches none of the date formats ${formats.join(', ')}`);
  const check = convert(date);
  if (!check.ok) return check;
  const start = date.m >= 4 ? date.y : date.y - 1;
  return ok(`${start}/${pad((start + 1) % 100)}`, check.warnings);
}
