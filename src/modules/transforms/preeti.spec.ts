import fc from 'fast-check';
import golden from '../../../test/fixtures/transforms/preeti-golden.json';
import { FEMALE, MALE, SURNAMES } from '../../../tools/generate-legacy-data';
import { preetiToUnicode } from './preeti';

const convert = (text: string): string => {
  const result = preetiToUnicode(text);
  if (!result.ok) throw new Error(result.error);
  return result.value;
};

describe('preetiToUnicode', () => {
  it.each(golden.cases)('converts %s to %s', (preeti, unicode) => {
    expect(convert(preeti)).toBe(unicode);
  });

  it.each([...MALE, ...FEMALE, ...SURNAMES].map((n) => [n.preeti, n.ne]))(
    'converts the generator name %s to %s',
    (preeti, unicode) => {
      expect(convert(preeti)).toBe(unicode);
    },
  );

  it('converts a full name with a space between words', () => {
    expect(convert('/fd yfkf')).toBe('राम थापा');
  });

  it('decodes Latin-1 conjunct keys as a Windows-1252 decoder delivers them', () => {
    expect(convert('ljåfg')).toBe('विद्वान');
  });

  it('warns when a reph has no syllable to attach to', () => {
    const result = preetiToUnicode('{');
    expect(result.ok && result.warnings).toEqual([
      'some Preeti modifiers could not be attached to a letter',
    ]);
  });

  it('never throws and always returns NFC text, for any ASCII input', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 60 }), (text) => {
        const result = preetiToUnicode(text);
        return result.ok && result.value === result.value.normalize('NFC');
      }),
      { numRuns: 1000 },
    );
  });

  it('turns any run of Preeti letter keys into text without Latin letters except the modifier', () => {
    const letterKeys = [...'abcdefghijklnopqrstuvwxyzABCDEGHIJKLNOPQRSTUVWXYZ'];
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...letterKeys), { minLength: 1 }), (keys) => {
        const result = preetiToUnicode(keys.join(''));
        return result.ok && !/[A-Za-z]/.test(result.value);
      }),
      { numRuns: 1000 },
    );
  });
});
