/**
 * Builds a profile of a legacy file one row at a time (pure code: no I/O), so a 100,000-row
 * file is profiled in constant memory apart from the capped distinct-value counts.
 */

export type ColumnProfile = {
  name: string;
  filled: number;
  empty: number;
  emptyPct: number;
  distinct: number;
  /** True when there were more distinct values than we count; `distinct` is then a floor. */
  distinctCapped: boolean;
  topValues: { value: string; count: number }[];
  length: { min: number; max: number } | null;
  /** Value shapes: 9 = digit, ९ = Devanagari digit, a = Latin word, क = Devanagari word. */
  patterns: { pattern: string; count: number }[];
  /** Share of filled values that look like Preeti-font text, and whether the column does. */
  preeti: { share: number; likely: boolean };
  dateFormats: { format: string; count: number }[];
  numeric: { min: number; max: number; mean: number } | null;
};

export type ProfileReport = {
  status: 'ok';
  encoding: string;
  rowCount: number;
  /** Rows whose number of fields differs from the header. */
  raggedRows: number;
  columns: ColumnProfile[];
};

const DISTINCT_CAP = 10_000;
const PATTERN_CAP = 1_000;
const TOP = 5;
const PREETI_COLUMN_SHARE = 0.6;
const NUMERIC_COLUMN_SHARE = 0.9;

const DIGIT = '[0-9०-९]';
export const DATE_FORMATS: { format: string; regex: RegExp }[] = [
  { format: 'YYYY/M/D', regex: new RegExp(`^${DIGIT}{4}/${DIGIT}{1,2}/${DIGIT}{1,2}$`) },
  { format: 'YYYY-MM-DD', regex: new RegExp(`^${DIGIT}{4}-${DIGIT}{2}-${DIGIT}{2}$`) },
  { format: 'D/M/YYYY', regex: new RegExp(`^${DIGIT}{1,2}/${DIGIT}{1,2}/${DIGIT}{4}$`) },
  { format: 'YYYY.MM.DD', regex: new RegExp(`^${DIGIT}{4}\\.${DIGIT}{2}\\.${DIGIT}{2}$`) },
];

// Preeti uses these keys for र स े ृ reph ै ु ू ्र ्, so they sit inside or next to letters.
const PREETI_PUNCTUATION = /[A-Za-z][/;[\]{}'"|\\]|[/;[\]{}'"|\\][A-Za-z]/;

/**
 * Preeti text is Nepali typed on Latin keys: it reads as consonant soup with almost no vowels
 * ("bLks yfkf" = दीपक थापा) or with punctuation inside words ("a/fn" = बराल).
 */
export function looksLikePreeti(value: string): boolean {
  const letters = value.match(/[A-Za-z]/g) ?? [];
  if (letters.length < 2) return false;
  if (PREETI_PUNCTUATION.test(value)) return true;
  const vowels = letters.filter((c) => 'aeiouAEIOU'.includes(c)).length;
  return vowels / letters.length < 0.2;
}

export function shapeOf(value: string): string {
  return value
    .replace(/[0-9]/g, '9')
    .replace(/[०-९]/g, '९')
    .replace(/[A-Za-z]+/g, 'a')
    .replace(/[ऀ-ॣॱ-ॿ]+/g, 'क')
    .replace(/\s+/g, ' ');
}

const top = (counts: Map<string, number>, n: number) =>
  [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, n)
    .map(([key, count]) => ({ key, count }));

class ColumnStats {
  private filled = 0;
  private empty = 0;
  private readonly values = new Map<string, number>();
  private distinctCapped = false;
  private readonly patterns = new Map<string, number>();
  private minLength = Infinity;
  private maxLength = 0;
  private preeti = 0;
  private readonly dates = new Map<string, number>();
  private numericCount = 0;
  private numericMin = Infinity;
  private numericMax = -Infinity;
  private numericSum = 0;

  constructor(private readonly name: string) {}

  add(raw: string | undefined): void {
    const value = (raw ?? '').trim();
    if (value === '') {
      this.empty += 1;
      return;
    }
    this.filled += 1;

    const seen = this.values.get(value);
    if (seen !== undefined) this.values.set(value, seen + 1);
    else if (this.values.size < DISTINCT_CAP) this.values.set(value, 1);
    else this.distinctCapped = true;

    const shape = shapeOf(value);
    const shapeCount = this.patterns.get(shape);
    if (shapeCount !== undefined) this.patterns.set(shape, shapeCount + 1);
    else if (this.patterns.size < PATTERN_CAP) this.patterns.set(shape, 1);

    this.minLength = Math.min(this.minLength, value.length);
    this.maxLength = Math.max(this.maxLength, value.length);
    if (looksLikePreeti(value)) this.preeti += 1;

    const date = DATE_FORMATS.find((f) => f.regex.test(value));
    if (date) this.dates.set(date.format, (this.dates.get(date.format) ?? 0) + 1);

    if (/^-?\d+(\.\d+)?$/.test(value)) {
      const n = Number(value);
      this.numericCount += 1;
      this.numericMin = Math.min(this.numericMin, n);
      this.numericMax = Math.max(this.numericMax, n);
      this.numericSum += n;
    }
  }

  result(): ColumnProfile {
    const total = this.filled + this.empty;
    const share = (n: number) => (this.filled === 0 ? 0 : round(n / this.filled));
    const preetiShare = share(this.preeti);
    return {
      name: this.name,
      filled: this.filled,
      empty: this.empty,
      emptyPct: total === 0 ? 0 : round((100 * this.empty) / total),
      distinct: this.values.size,
      distinctCapped: this.distinctCapped,
      topValues: top(this.values, TOP).map(({ key, count }) => ({ value: key, count })),
      length: this.filled === 0 ? null : { min: this.minLength, max: this.maxLength },
      patterns: top(this.patterns, TOP).map(({ key, count }) => ({ pattern: key, count })),
      preeti: { share: preetiShare, likely: preetiShare >= PREETI_COLUMN_SHARE },
      dateFormats: top(this.dates, DATE_FORMATS.length).map(({ key, count }) => ({
        format: key,
        count,
      })),
      numeric:
        this.filled > 0 && this.numericCount / this.filled >= NUMERIC_COLUMN_SHARE
          ? {
              min: this.numericMin,
              max: this.numericMax,
              mean: round(this.numericSum / this.numericCount),
            }
          : null,
    };
  }
}

const round = (n: number): number => Math.round(n * 1000) / 1000;

export class FileProfiler {
  private columns: ColumnStats[] | undefined;
  private names: string[] = [];
  private rowCount = 0;
  private raggedRows = 0;

  add(values: Record<string, string>): void {
    if (!this.columns) {
      this.names = Object.keys(values);
      this.columns = this.names.map((name) => new ColumnStats(name));
    }
    this.rowCount += 1;
    if (Object.keys(values).length !== this.names.length) this.raggedRows += 1;
    this.names.forEach((name, i) => this.columns![i]!.add(values[name]));
  }

  report(encoding: string): ProfileReport {
    return {
      status: 'ok',
      encoding,
      rowCount: this.rowCount,
      raggedRows: this.raggedRows,
      columns: (this.columns ?? []).map((c) => c.result()),
    };
  }
}
