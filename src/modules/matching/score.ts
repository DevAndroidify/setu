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
 * Blocking key: only records in the same district and birth year are compared, which keeps
 * the comparisons per row small instead of comparing every pair. No date of birth, no block.
 */
export function blockKey(district: string | null, dobAd: string | null): string | null {
  if (!dobAd) return null;
  return `${district ?? '?'}|${dobAd.slice(0, 4)}`;
}

export function compare(a: MatchRecord, b: MatchRecord): MatchResult {
  const name = Math.max(
    jaroWinkler(transliterate(a.name_ne), transliterate(b.name_ne)),
    jaroWinkler(plain(a.name_en), plain(b.name_en)),
  );
  const dob = a.dob_ad && b.dob_ad ? (a.dob_ad === b.dob_ad ? 1 : 0) : 0.5;
  const father =
    a.father_name_ne && b.father_name_ne
      ? jaroWinkler(givenName(a.father_name_ne), givenName(b.father_name_ne))
      : 0.5;
  const citizenship =
    a.citizenship_no && b.citizenship_no
      ? a.citizenship_no === b.citizenship_no
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
export function bestMatch<C extends { record: MatchRecord }>(
  record: MatchRecord,
  candidates: C[],
): (MatchResult & { candidate: C }) | null {
  let best: (MatchResult & { candidate: C }) | null = null;
  for (const candidate of candidates) {
    const result = compare(record, candidate.record);
    if (result.score >= REVIEW && (!best || result.score > best.score)) {
      best = { ...result, candidate };
    }
  }
  return best;
}
