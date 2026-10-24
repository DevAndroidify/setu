import { splitName, trim } from './text';

describe('trim', () => {
  it('trims and collapses whitespace, including non-breaking spaces', () => {
    expect(trim('  ram   thapa \t')).toEqual({ ok: true, value: 'ram thapa', warnings: [] });
  });

  it('normalizes decomposed Unicode to NFC', () => {
    expect(trim('क़')).toMatchObject({ value: 'क़'.normalize('NFC') });
  });

  it('keeps zero-width joiners, which change Devanagari conjunct rendering', () => {
    expect(trim('र्‍य')).toMatchObject({ value: 'र्‍य' });
  });
});

describe('splitName', () => {
  it('splits first, middle and last names', () => {
    expect(splitName('Ram Bahadur Thapa')).toEqual({
      ok: true,
      value: { first: 'Ram', middle: 'Bahadur', last: 'Thapa' },
      warnings: [],
    });
  });

  it('handles Devanagari names and extra spaces', () => {
    expect(splitName('  राम   थापा ')).toMatchObject({
      value: { first: 'राम', middle: '', last: 'थापा' },
    });
  });

  it('warns when a name has only one word', () => {
    expect(splitName('Ram')).toEqual({
      ok: true,
      value: { first: 'Ram', middle: '', last: '' },
      warnings: ['name has no last name'],
    });
  });

  it('returns empty parts for a blank name', () => {
    expect(splitName(' ')).toMatchObject({ value: { first: '', middle: '', last: '' } });
  });
});
