/**
 * Devanagari to a plain Latin spelling, for comparing names: "राम थापा" -> "ram thapa". It is
 * deliberately lossy (long and short vowels, retroflex and dental consonants collapse) so that
 * the same name written slightly differently transliterates the same.
 */

const CONSONANTS: Record<string, string> = {
  क: 'k', ख: 'kh', ग: 'g', घ: 'gh', ङ: 'ng',
  च: 'ch', छ: 'chh', ज: 'j', झ: 'jh', ञ: 'ny',
  ट: 't', ठ: 'th', ड: 'd', ढ: 'dh', ण: 'n',
  त: 't', थ: 'th', द: 'd', ध: 'dh', न: 'n',
  प: 'p', फ: 'ph', ब: 'b', भ: 'bh', म: 'm',
  य: 'y', र: 'r', ल: 'l', व: 'w', श: 'sh', ष: 'sh', स: 's', ह: 'h',
}; // prettier-ignore

const VOWELS: Record<string, string> = {
  अ: 'a', आ: 'a', इ: 'i', ई: 'i', उ: 'u', ऊ: 'u', ऋ: 'ri', ए: 'e', ऐ: 'ai', ओ: 'o', औ: 'au',
}; // prettier-ignore

const VOWEL_SIGNS: Record<string, string> = {
  'ा': 'a', 'ि': 'i', 'ी': 'i', 'ु': 'u', 'ू': 'u', 'ृ': 'ri', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au',
}; // prettier-ignore

const VIRAMA = '्';
const NASAL = new Set(['ं', 'ँ']);
const NUKTA = '़';
const VISARGA = 'ः';

export function transliterate(text: string): string {
  let out = '';
  // A consonant carries an inherent "a" unless a vowel sign or virama follows it, and Nepali
  // drops it at the end of a word (राम = ram, not rama).
  let inherent = false;
  const flush = (atWordEnd: boolean) => {
    if (inherent && !atWordEnd) out += 'a';
    inherent = false;
  };

  for (const char of text.normalize('NFC')) {
    if (char === NUKTA) continue;
    const consonant = CONSONANTS[char];
    if (consonant !== undefined) {
      flush(false);
      out += consonant;
      inherent = true;
    } else if (VOWEL_SIGNS[char] !== undefined) {
      inherent = false;
      out += VOWEL_SIGNS[char];
    } else if (char === VIRAMA) {
      inherent = false;
    } else if (NASAL.has(char)) {
      flush(false);
      out += 'n';
    } else if (char === VISARGA) {
      flush(false);
      out += 'h';
    } else if (VOWELS[char] !== undefined) {
      flush(false);
      out += VOWELS[char];
    } else {
      flush(true);
      out += char;
    }
  }
  flush(true);
  return out.toLowerCase().replace(/\s+/g, ' ').trim();
}
