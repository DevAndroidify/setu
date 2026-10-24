import { compileRule, Rule, todayInNepal } from './rules';

const ctx = { today: '2026-10-24' };
const rule = (spec: string): Rule => {
  const compiled = compileRule(spec);
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

  it('lets empty optional values pass every rule except required', () => {
    for (const spec of ['notFuture', 'after:1940-01-01', 'citizenshipFormat', 'maxLength:3']) {
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
