import { jaroWinkler } from './jaro-winkler';
import { transliterate } from './transliterate';

/** What the matcher compares about a person. */
export type MatchRecord = {
  name_ne: string;
  name_en: string;
  dob_ad: string | null;
  father_name_ne: string | null;
  citizenship_no: string | null;
};

export type MatchFeatures = {
  /** Best of the transliterated Nepali name and the English name, Jaro-Winkler. */
  name: number;
  /** 1 same date of birth, 0 different, 0.5 unknown. */
  dob: number;
  /** Father's given name, Jaro-Winkler on the transliteration; 0.5 unknown. */
  father: number;
  citizenship: 'same' | 'different' | 'unknown';
};

export type MatchResult = { score: number; features: MatchFeatures };

/** At or above: the same person, linked without review. */
export const AUTO_LINK = 0.95;
/** At or above (and below AUTO_LINK): a reviewer decides. Below: different people. */
export const REVIEW = 0.8;

const WEIGHTS = { name: 0.55, dob: 0.25, father: 0.2 };
const round = (n: number): number => Math.round(n * 1000) / 1000;
const plain = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();
// A father usually shares the surname of everyone in the family, so only his given name
// tells two fathers apart.
const givenName = (ne: string): string => transliterate(ne).split(' ')[0] ?? '';

/**
 * Blocking key: only records in the same district born on the same day are compared, instead
 * of every pair. The block can be this narrow without losing a match: two records with
 * different birth dates score at most name + father = 0.75, below REVIEW, so they could never
 * match by score (a shared citizenship number is compared separately, across blocks). It was
 * district + birth year until the 100,000-row load test (docs/adr/0006). No date, no block.
 */
export function blockKey(district: string | null, dobAd: string | null): string | null {
  if (!dobAd) return null;
  return `${district ?? '?'}|${dobAd}`;
}

/** A record with its comparison forms worked out once, not once per pair. */
export type PreparedRecord = {
  nameNe: string;
  nameEn: string;
  father: string | null;
  dob: string | null;
  citizenship: string | null;
};

export function prepare(r: MatchRecord): PreparedRecord {
  return {
    nameNe: transliterate(r.name_ne),
    nameEn: plain(r.name_en),
    father: r.father_name_ne ? givenName(r.father_name_ne) : null,
    dob: r.dob_ad,
    citizenship: r.citizenship_no,
  };
}

export function compare(a: MatchRecord, b: MatchRecord): MatchResult {
  return comparePrepared(prepare(a), prepare(b));
}

export function comparePrepared(a: PreparedRecord, b: PreparedRecord): MatchResult {
  const name = Math.max(jaroWinkler(a.nameNe, b.nameNe), jaroWinkler(a.nameEn, b.nameEn));
  const dob = a.dob && b.dob ? (a.dob === b.dob ? 1 : 0) : 0.5;
  const father = a.father && b.father ? jaroWinkler(a.father, b.father) : 0.5;
  const citizenship =
    a.citizenship && b.citizenship
      ? a.citizenship === b.citizenship
        ? 'same'
        : 'different'
      : 'unknown';

  // Names must be alike before anything else counts: a shared birthday and father do not make
  // two differently named people one person (they are more likely siblings).
  let score = Math.min(name, WEIGHTS.name * name + WEIGHTS.dob * dob + WEIGHTS.father * father);
  // A shared citizenship number always needs at least a human look; two different numbers
  // mean two different people, however alike the rest is.
  if (citizenship === 'same') score = Math.max(score, 0.9);
  if (citizenship === 'different') score = Math.min(score, 0.7);
  return {
    score: round(score),
    features: { name: round(name), dob, father: round(father), citizenship },
  };
}

/** The best-scoring candidate at or above the review threshold; ties go to the earliest. */
export function bestMatch<C extends { prepared: PreparedRecord }>(
  record: PreparedRecord,
  candidates: C[],
): (MatchResult & { candidate: C }) | null {
  let best: (MatchResult & { candidate: C }) | null = null;
  for (const candidate of candidates) {
    const result = comparePrepared(record, candidate.prepared);
    if (result.score >= REVIEW && (!best || result.score > best.score)) {
      best = { ...result, candidate };
    }
  }
  return best;
}
