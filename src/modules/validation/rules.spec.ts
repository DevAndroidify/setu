import { buildAddressReference } from '../transforms';
import { compileRule, Rule, todayInNepal } from './rules';

const ctx = { today: '2026-10-24' };
const ref = buildAddressReference([{ code: 'kaski-pokhara', wardCount: 33 }], []);
const rule = (spec: string): Rule => {
  const compiled = compileRule(spec, ref);
  if (typeof compiled !== 'function') throw new Error(compiled.error);
  return compiled;
};

describe('validation rules', () => {
  it('requires a value', () => {
    expect(rule('required')(null, ctx)).toBe('is required');
    expect(rule('required')('', ctx)).toBe('is required');
    expect(rule('required')('राम', ctx)).toBeNull();
  });

  it('rejects a date of birth in the future', () => {
    expect(rule('notFuture')('2027-01-01', ctx)).toBe('2027-01-01 is in the future');
    expect(rule('notFuture')('2026-10-24', ctx)).toBeNull();
  });

  it('rejects a date before the given limit', () => {
    expect(rule('after:1940-01-01')('1926-03-02', ctx)).toBe('1926-03-02 is before 1940-01-01');
    expect(rule('after:1940-01-01')('1987-07-12', ctx)).toBeNull();
  });

  it('checks the citizenship number format without echoing the number', () => {
    const message = rule('citizenshipFormat')('85-07-47', ctx);
    expect(message).toMatch(/not a valid citizenship number/);
    expect(message).not.toContain('85-07-47');
    expect(rule('citizenshipFormat')('85-07-47-78354', ctx)).toBeNull();
    expect(rule('citizenshipFormat')('85-O7-47-78354', ctx)).not.toBeNull();
  });

  it('quarantines a row whose ward exceeds the local unit ward count', () => {
    const pokhara = { local_unit_code: 'kaski-pokhara' };
    expect(rule('wardInUnit')('34', ctx, pokhara)).toBe(
      'ward 34 exceeds the 33 wards of kaski-pokhara',
    );
    expect(rule('wardInUnit')('0', ctx, pokhara)).toBe('ward numbers start at 1');
    expect(rule('wardInUnit')('33', ctx, pokhara)).toBeNull();
    expect(rule('wardInUnit')('3', ctx, { local_unit_code: 'nowhere' })).toMatch(
      /not in the reference/,
    );
  });

  it('leaves the ward to the address check when the local unit is unknown', () => {
    expect(rule('wardInUnit')('3', ctx, { local_unit_code: null })).toBeNull();
  });

  it('caps a number at the given maximum', () => {
    expect(rule('max:9')('12', ctx)).toBe('12 is more than 9');
    expect(rule('max:9')('9', ctx)).toBeNull();
    expect(compileRule('max:nine')).toHaveProperty('error');
  });

  it('lets empty optional values pass every rule except required', () => {
    for (const spec of [
      'notFuture',
      'after:1940-01-01',
      'citizenshipFormat',
      'maxLength:3',
      'max:9',
      'wardInUnit',
    ]) {
      expect(rule(spec)(null, ctx)).toBeNull();
    }
  });

  it('rejects unknown rules and bad parameters', () => {
    expect(compileRule('wardExists')).toEqual({ error: 'unknown rule "wardExists"' });
    expect(compileRule('after:soon')).toHaveProperty('error');
    expect(compileRule('maxLength:x')).toHaveProperty('error');
  });
});

describe('todayInNepal', () => {
  it('uses Nepal time: 20:00 UTC is already the next day in Kathmandu', () => {
    expect(todayInNepal(new Date('2026-10-23T20:00:00Z'))).toBe('2026-10-24');
  });
});
