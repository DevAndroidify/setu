import fc from 'fast-check';
import golden from '../../../test/fixtures/transforms/bs-dates-golden.json';
import { adToBs, bsToAd, fiscalYear } from './bs-date';

describe('bsToAd', () => {
  it.each(golden.cases)('converts BS %s to AD %s', (bs, ad) => {
    expect(bsToAd(bs)).toEqual({ ok: true, value: ad, warnings: [] });
  });

  it.each(golden.invalid)('rejects %s, which does not exist in the BS calendar', (bs) => {
    expect(bsToAd(bs).ok).toBe(false);
  });

  it.each([
    ['2045/3/12', 'YYYY/M/D'],
    ['2045-03-12', 'YYYY-MM-DD'],
    ['12/3/2045', 'D/M/YYYY'],
    ['2045.03.12', 'YYYY.MM.DD'],
  ])('reads %s in the %s format as the same date', (input) => {
    expect(bsToAd(input)).toEqual(bsToAd('2045-03-12'));
  });

  it('only accepts the formats it is given', () => {
    const result = bsToAd('12/3/2045', { formats: ['YYYY-MM-DD'] });
    expect(result).toEqual({
      ok: false,
      error: '"12/3/2045" matches none of the date formats YYYY-MM-DD',
    });
  });

  it('rejects a year before the BS range and suggests it may be AD', () => {
    const result = bsToAd('1960-06-25');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/may be an AD date/);
  });

  it('warns about an unusually early BS year that converts', () => {
    const result = bsToAd('1990/5/10');
    expect(result.ok && result.warnings[0]).toMatch(/check it is not an AD date/);
  });

  it('passes blank input through unchanged', () => {
    expect(bsToAd('  ')).toEqual({ ok: true, value: '', warnings: [] });
  });

  it('rejects text that is not a date', () => {
    expect(bsToAd('unknown').ok).toBe(false);
  });
});

describe('adToBs', () => {
  it('round-trips every AD date in the supported range through BS', () => {
    const start = Date.UTC(1918, 3, 13);
    const end = Date.UTC(2043, 3, 13);
    fc.assert(
      fc.property(fc.integer({ min: start, max: end }), (ms) => {
        const ad = new Date(ms).toISOString().slice(0, 10);
        const bs = adToBs(ad);
        if (!bs.ok) return false;
        const back = bsToAd(bs.value, { formats: ['YYYY-MM-DD'] });
        return back.ok && back.value === ad;
      }),
      { numRuns: 1000 },
    );
  });

  it('rejects a date that does not exist in the AD calendar', () => {
    expect(adToBs('2023-02-29').ok).toBe(false);
  });
});

describe('fiscalYear', () => {
  it.each([
    ['2080/4/1', '2080/81'],
    ['2081/3/31', '2080/81'],
    ['2080/12/30', '2080/81'],
    ['2099/5/1', '2099/00'],
  ])('puts %s in fiscal year %s', (date, fy) => {
    expect(fiscalYear(date)).toEqual({ ok: true, value: fy, warnings: [] });
  });

  it('rejects a date that does not exist', () => {
    expect(fiscalYear('2080/12/31').ok).toBe(false);
  });
});
