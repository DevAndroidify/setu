import { ok, TransformResult } from './transform-result';

const DEVANAGARI_ZERO = 0x0966;

/** Replaces Devanagari digits (०-९) with ASCII digits; everything else is left as is. */
export function devanagariDigits(input: string): TransformResult<string> {
  return ok(input.replace(/[०-९]/g, (digit) => String(digit.charCodeAt(0) - DEVANAGARI_ZERO)));
}
