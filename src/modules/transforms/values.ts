import { fail, ok, TransformResult } from './transform-result';

/**
 * Replaces a code with its meaning using a lookup table, e.g. "Purush" -> "male".
 * A value missing from the table fails, so unexpected codes are quarantined, not guessed.
 */
export function mapValues(
  input: string,
  args: { values: Record<string, string>; caseInsensitive?: boolean },
): TransformResult<string> {
  const text = input.trim();
  if (text === '') return ok('');
  const insensitive = args.caseInsensitive ?? true;
  const key = insensitive ? text.toLowerCase() : text;
  for (const [from, to] of Object.entries(args.values)) {
    if ((insensitive ? from.toLowerCase() : from) === key) return ok(to);
  }
  return fail(
    `"${text}" is not one of the expected values (${Object.keys(args.values).join(', ')})`,
  );
}
