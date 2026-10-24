import { ok, TransformResult } from './transform-result';

/**
 * Trims, collapses runs of whitespace (including non-breaking spaces) to one space and applies
 * Unicode NFC. Zero-width joiners are kept: they change how Devanagari conjuncts render.
 */
export function trim(input: string): TransformResult<string> {
  return ok(input.normalize('NFC').replace(/\s+/g, ' ').trim());
}

export type NameParts = { first: string; middle: string; last: string };

/** Splits a full name into first, middle (zero or more words) and last name. */
export function splitName(input: string): TransformResult<NameParts> {
  const words = input.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return ok({ first: '', middle: '', last: '' });
  if (words.length === 1) {
    return ok({ first: words[0] ?? '', middle: '', last: '' }, ['name has no last name']);
  }
  return ok({
    first: words[0] ?? '',
    middle: words.slice(1, -1).join(' '),
    last: words[words.length - 1] ?? '',
  });
}
