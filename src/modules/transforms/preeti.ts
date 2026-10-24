import { ok, TransformResult } from './transform-result';

/**
 * Preeti is a legacy font that draws Devanagari glyphs on Latin keys, so Preeti text is stored
 * as ASCII and Latin-1 characters. Converting it takes two steps:
 *   1. map each key to the Unicode it draws;
 *   2. reorder, because Preeti text is typed in visual order, not Unicode's logical order
 *      (e.g. the short-i sign ि is typed before its consonant, the reph र् after its syllable).
 * The table below is the Preeti keyboard layout. The Latin-1 keys are listed as the characters
 * a Windows-1252 decoder produces for those bytes.
 */
const KEYS: Record<string, string> = {
  // Consonants and independent vowels
  a: 'ब',
  b: 'द',
  c: 'अ',
  d: 'म',
  e: 'भ',
  g: 'न',
  h: 'ज',
  j: 'व',
  k: 'प',
  n: 'ल',
  o: 'य',
  p: 'उ',
  q: 'त्र',
  r: 'च',
  s: 'क',
  t: 'त',
  u: 'ग',
  v: 'ख',
  w: 'ध',
  x: 'ह',
  y: 'थ',
  z: 'श',
  C: 'ऋ',
  O: 'इ',
  P: 'ए',
  Q: 'त्त',
  ';': 'स',
  '/': 'र',
  '>': 'श्र',
  '`': 'ञ',
  '1': 'ज्ञ',
  '2': 'द्द',
  '3': 'घ',
  '4': 'द्ध',
  '5': 'छ',
  '6': 'ट',
  '7': 'ठ',
  '8': 'ड',
  '9': 'ढ',
  // Half (dead) consonants
  A: 'ब्',
  D: 'म्',
  E: 'भ्',
  G: 'न्',
  H: 'ज्',
  I: 'क्ष्',
  J: 'व्',
  K: 'प्',
  N: 'ल्',
  R: 'च्',
  S: 'क्',
  T: 'त्',
  U: 'ग्',
  V: 'ख्',
  W: 'ध्',
  X: 'ह्',
  Y: 'थ्',
  Z: 'श्',
  i: 'ष्',
  ':': 'स्',
  '0': 'ण्',
  '~': 'ञ्',
  B: 'द्य',
  // Vowel signs and other marks
  f: 'ा',
  l: 'ि',
  L: 'ी',
  "'": 'ु',
  '"': 'ू',
  '[': 'ृ',
  ']': 'े',
  '}': 'ै',
  '+': 'ं',
  F: 'ँ',
  M: 'ः',
  '\\': '्',
  '|': '्र',
  '?': 'रु',
  '.': '।',
  '=': '.',
  '-': '(',
  _: ')',
  '<': '?',
  // Digits are on the shifted number keys
  '!': '१',
  '@': '२',
  '#': '३',
  $: '४',
  '%': '५',
  '^': '६',
  '&': '७',
  '*': '८',
  '(': '९',
  ')': '०',
  // Latin-1 / Windows-1252 keys
  Ë: 'ङ्ग',
  å: 'द्व',
  ß: 'द्म',
  Í: 'ङ्क',
  Î: 'ङ्ख',
  '°': 'ङ्ढ',
  '‹': 'ङ्घ',
  '¶': 'ठ्ठ',
  '§': 'ट्ट',
  '•': 'ड्ड',
  '¿': 'रू',
  Ø: '्य',
  Ì: 'न्न',
  '„': 'ध्र',
  ˆ: 'फ्',
  '‰': 'झ्',
  '´': 'झ',
  '¡': 'ज्ञ्',
  '¢': 'द्घ',
  '£': 'घ्',
  '¤': 'झ्',
  ç: 'ॐ',
  Å: 'हृ',
  Ý: 'ट्ठ',
  '«': '्र',
  '›': 'द्र',
  ª: 'ङ',
  '©': 'र',
  '˜': 'ऽ',
  '÷': '/',
  '×': '×',
  Ö: '=',
  Ù: ';',
  Û: '!',
  Ü: '%',
  '±': '+',
  æ: '“',
  Æ: '”',
  Ú: '’',
  '…': '‘',
};

// 'm' draws no letter of its own: it adds a stroke that turns उ into ऊ, प into फ, and so on.
// '{' is the reph (र् drawn above), typed after the syllable it belongs to.
const MODIFIER = 'm';
const REPH = '{';

// क-ह plus the precomposed nukta letters क़-य़.
const CONSONANT = '[\\u0915-\\u0939\\u0958-\\u095F]';
const SIGNS = '[ािीुूृेैोौंँः]';
const CLUSTER = `(?:${CONSONANT}्)*${CONSONANT}`;

const MODIFIED: Record<string, string> = { उ: 'ऊ', प: 'फ', भ: 'झ', त्र: 'क्र', त्त: 'क्त' };

const REORDER: [RegExp, string | ((...groups: string[]) => string)][] = [
  // Half letter + ा is the full letter (Preeti has no separate key for some full forms).
  [/्ा/g, ''],
  // The modifier may be typed after signs that follow its base letter.
  [
    new RegExp(`(त्र|त्त|उ|प|भ)(${SIGNS}*)${MODIFIER}`, 'g'),
    (_, base: string, signs: string) => (MODIFIED[base] ?? base) + signs,
  ],
  // इ + reph is drawn as ई.
  [new RegExp(`इ\\${REPH}`, 'g'), 'ई'],
  // Short i is typed before its consonant cluster.
  [new RegExp(`ि(${CLUSTER})`, 'g'), '$1ि'],
  // Reph moves to the start of the syllable it was typed after.
  [new RegExp(`(${CLUSTER}${SIGNS}*)\\${REPH}`, 'g'), 'र्$1'],
  // Nasal marks are sometimes typed before vowel signs.
  [/([ंँ])([ािीुूृेैोौः]+)/g, '$2$1'],
  // Composite vowels typed as two parts.
  [/ेा/g, 'ाे'],
  [/ैा/g, 'ाै'],
  [/अाे/g, 'ओ'],
  [/अाै/g, 'औ'],
  [/अा/g, 'आ'],
  [/एे/g, 'ऐ'],
  [/ाे/g, 'ो'],
  [/ाै/g, 'ौ'],
];

/** Converts Preeti-font text to Unicode Devanagari. */
export function preetiToUnicode(input: string): TransformResult<string> {
  let text = '';
  for (const char of input) text += KEYS[char] ?? char;
  for (const [pattern, replacement] of REORDER) {
    text =
      typeof replacement === 'string'
        ? text.replace(pattern, replacement)
        : text.replace(pattern, replacement);
  }
  const warnings =
    text.includes(MODIFIER) || text.includes(REPH)
      ? ['some Preeti modifiers could not be attached to a letter']
      : [];
  return ok(text.normalize('NFC'), warnings);
}
