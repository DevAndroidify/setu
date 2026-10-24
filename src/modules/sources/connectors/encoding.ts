export type TextEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252';

/** How many leading bytes to inspect. Enough to find non-UTF-8 bytes in typical exports. */
export const SNIFF_BYTES = 64 * 1024;

/**
 * Guesses a legacy file's text encoding from its first bytes: a byte-order mark wins; otherwise
 * bytes that are not valid UTF-8 mean an 8-bit Windows export. Windows-1252 decodes every byte,
 * so it is the safe fallback for Preeti-era files.
 */
export function detectEncoding(sample: Uint8Array): TextEncoding {
  if (sample[0] === 0xef && sample[1] === 0xbb && sample[2] === 0xbf) return 'utf-8';
  if (sample[0] === 0xff && sample[1] === 0xfe) return 'utf-16le';
  if (sample[0] === 0xfe && sample[1] === 0xff) return 'utf-16be';
  try {
    // stream: true tolerates a multi-byte character cut off at the end of the sample.
    new TextDecoder('utf-8', { fatal: true }).decode(sample, { stream: true });
    return 'utf-8';
  } catch {
    return 'windows-1252';
  }
}

/** True if the bytes look like a binary file (NUL bytes never appear in 8-bit or UTF-8 text). */
export function looksBinary(sample: Uint8Array, encoding: TextEncoding): boolean {
  return !encoding.startsWith('utf-16') && sample.includes(0);
}
