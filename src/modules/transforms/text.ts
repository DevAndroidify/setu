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

/** "RAM  bahadur THAPA" -> "Ram Bahadur Thapa". Leaves non-Latin scripts as they are. */
export function titleCase(input: string): TransformResult<string> {
  const text = input.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
  return ok(
    text.replace(/(^|[\s'-])([a-z])/g, (_, sep: string, ch: string) => sep + ch.toUpperCase()),
  );
}

/** Picks one part of a full name (see splitName). */
export function namePart(input: string, args: { part: keyof NameParts }): TransformResult<string> {
  const result = splitName(input);
  if (!result.ok) return result;
  return ok(result.value[args.part], result.warnings);
}
