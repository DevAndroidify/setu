import fc from 'fast-check';
import { FEMALE, MALE, SURNAMES } from '../../../tools/generate-legacy-data';
import { jaroWinkler } from './jaro-winkler';
import { AUTO_LINK, bestMatch, blockKey, compare, MatchRecord, REVIEW } from './score';
import { transliterate } from './transliterate';

describe('jaroWinkler', () => {
  it.each([
    ['MARTHA', 'MARHTA', 0.961],
    ['DWAYNE', 'DUANE', 0.84],
    ['DIXON', 'DICKSONX', 0.813],
    ['ram thapa', 'raam thappa', 0.848],
  ])('scores %s / %s as %d', (a, b, expected) => {
    expect(jaroWinkler(a, b)).toBeCloseTo(expected, 2);
  });

  it('is 1 for identical strings and 0 when nothing matches', () => {
    expect(jaroWinkler('sita', 'sita')).toBe(1);
    expect(jaroWinkler('abc', 'xyz')).toBe(0);
    expect(jaroWinkler('', 'sita')).toBe(0);
  });

  it('is symmetric and stays within 0 and 1 for any strings', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (a, b) => {
        const s = jaroWinkler(a, b);
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(1);
        expect(jaroWinkler(b, a)).toBeCloseTo(s, 10);
      }),
      { numRuns: 1000 },
    );
  });
});

describe('transliterate', () => {
  it.each([
    ['राम थापा', 'ram thapa'],
    ['सीता मगर', 'sita magar'],
    ['श्याम', 'shyam'],
    ['दीपक खनाल', 'dipak khanal'],
    ['कमल बराल', 'kamal baral'],
    ['बिमला शाह', 'bimala shah'],
    ['हरि', 'hari'],
  ])('writes %s as %s', (ne, latin) => {
    expect(transliterate(ne)).toBe(latin);
  });

  it('spells long and short vowels the same, so variants compare equal', () => {
    expect(transliterate('गिता')).toBe(transliterate('गीता'));
  });

  it('never throws and leaves Latin text as it is', () => {
    fc.assert(fc.property(fc.string(), (s) => typeof transliterate(s) === 'string'));
    expect(transliterate('Ram Thapa')).toBe('ram thapa');
  });
});

const person = (over: Partial<MatchRecord> = {}): MatchRecord => ({
  name_ne: 'राम थापा',
  name_en: 'Ram Thapa',
  dob_ad: '1988-04-12',
  father_name_ne: 'हरि थापा',
  citizenship_no: null,
  ...over,
});

describe('compare', () => {
  it('auto-links a re-entered person whose English name is spelled differently', () => {
    const result = compare(person(), person({ name_en: 'Raam Thappa' }));
    expect(result.score).toBeGreaterThanOrEqual(AUTO_LINK);
  });

  it('auto-links every generator name pair re-entered with its spelling variant', () => {
    for (const given of [...MALE, ...FEMALE]) {
      for (const surname of SURNAMES) {
        const a = person({
          name_ne: `${given.ne} ${surname.ne}`,
          name_en: `${given.en} ${surname.en}`,
        });
        const b = { ...a, name_en: `${given.variant} ${surname.variant}` };
        expect(compare(a, b).score).toBeGreaterThanOrEqual(AUTO_LINK);
      }
    }
  });

  it('does not match siblings: same surname, father and birth year, different person', () => {
    const result = compare(
      person(),
      person({ name_ne: 'कमल थापा', name_en: 'Kamal Thapa', dob_ad: '1988-09-30' }),
    );
    expect(result.score).toBeLessThan(REVIEW);
  });

  it('sends a same-name, same-birthday pair with a different father to review', () => {
    const result = compare(person(), person({ father_name_ne: 'श्याम थापा' }));
    expect(result.score).toBeGreaterThanOrEqual(REVIEW);
    expect(result.score).toBeLessThan(AUTO_LINK);
  });

  it('always reviews a shared citizenship number, and never matches two different ones', () => {
    const other = person({ name_ne: 'सीता मगर', name_en: 'Sita Magar', dob_ad: '1990-01-01' });
    expect(
      compare(person({ citizenship_no: '85-01-50-00001' }), {
        ...other,
        citizenship_no: '85-01-50-00001',
      }).score,
    ).toBe(0.9);
    expect(
      compare(
        person({ citizenship_no: '85-01-50-00001' }),
        person({ citizenship_no: '85-01-50-00002' }),
      ).score,
    ).toBe(0.7);
  });

  it('is symmetric', () => {
    const a = person();
    const b = person({ name_en: 'Raam Thappa', father_name_ne: null });
    expect(compare(a, b)).toEqual(compare(b, a));
  });
});

describe('bestMatch and blockKey', () => {
  it('returns the highest-scoring candidate above the review threshold, or null', () => {
    const near = { id: 1, record: person({ father_name_ne: 'श्याम थापा' }) };
    const exact = { id: 2, record: person() };
    const far = { id: 3, record: person({ name_ne: 'सीता मगर', name_en: 'Sita Magar' }) };
    expect(bestMatch(person(), [near, exact, far])?.candidate.id).toBe(2);
    expect(bestMatch(person(), [far])).toBeNull();
  });

  it('blocks by district and birth year, and not at all without a date of birth', () => {
    expect(blockKey('kaski', '1988-04-12')).toBe('kaski|1988');
    expect(blockKey(null, '1988-04-12')).toBe('?|1988');
    expect(blockKey('kaski', null)).toBeNull();
  });
});
