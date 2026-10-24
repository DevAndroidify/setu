/**
 * Every transform returns a result instead of throwing: a bad value is data to quarantine, not
 * an exception. Blank input passes through unchanged; whether a field is required is a
 * validation rule, not a transform's concern.
 */
export type TransformResult<T> =
  { ok: true; value: T; warnings: string[] } | { ok: false; error: string };

export const ok = <T>(value: T, warnings: string[] = []): TransformResult<T> => ({
  ok: true,
  value,
  warnings,
});

export const fail = (error: string): TransformResult<never> => ({ ok: false, error });
