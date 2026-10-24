/**
 * Jaro-Winkler similarity in [0, 1]: 1 for identical strings, higher when strings share a
 * prefix, which suits names (typos and spelling variants tend to come late).
 */
export function jaroWinkler(a: string, b: string, prefixScale = 0.1): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatched = new Array<boolean>(a.length).fill(false);
  const bMatched = new Array<boolean>(b.length).fill(false);

  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const from = Math.max(0, i - window);
    const to = Math.min(b.length - 1, i + window);
    for (let j = from; j <= to; j++) {
      if (!bMatched[j] && a[i] === b[j]) {
        aMatched[i] = bMatched[j] = true;
        matches++;
        break;
      }
    }
  }
  if (matches === 0) return 0;

  let transpositions = 0;
  for (let i = 0, j = 0; i < a.length; i++) {
    if (!aMatched[i]) continue;
    while (!bMatched[j]) j++;
    if (a[i] !== b[j]) transpositions++;
    j++;
  }
  const m = matches;
  const jaro = (m / a.length + m / b.length + (m - transpositions / 2) / m) / 3;

  let prefix = 0;
  while (prefix < Math.min(4, a.length, b.length) && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * prefixScale * (1 - jaro);
}
