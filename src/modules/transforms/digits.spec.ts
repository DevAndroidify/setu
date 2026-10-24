import fc from 'fast-check';
import { devanagariDigits } from './digits';

describe('devanagariDigits', () => {
  it('replaces every Devanagari digit with its ASCII digit', () => {
    expect(devanagariDigits('२०८०-०१-१५')).toEqual({ ok: true, value: '2080-01-15', warnings: [] });
    expect(devanagariDigits('०१२३४५६७८९')).toMatchObject({ value: '0123456789' });
  });

  it('leaves text without Devanagari digits unchanged', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const clean = text.replace(/[०-९]/g, '');
        const result = devanagariDigits(clean);
        return result.ok && result.value === clean;
      }),
    );
  });

  it('keeps Devanagari letters while converting digits', () => {
    expect(devanagariDigits('वडा नं. ३')).toMatchObject({ value: 'वडा नं. 3' });
  });
});
