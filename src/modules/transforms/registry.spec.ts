import { compileStep, CompiledStep, runChain } from './registry';
import { namePart, titleCase } from './text';
import { mapValues } from './values';

const compile = (name: string, args?: unknown): CompiledStep => {
  const step = compileStep({ name, args });
  if ('error' in step) throw new Error(step.error);
  return step;
};

describe('transform registry', () => {
  it('runs a chain in order: Devanagari digits, then BS to AD', () => {
    const steps = [compile('devanagariDigits'), compile('bsToAd', { formats: ['YYYY-MM-DD'] })];
    expect(runChain('२०८०-०१-१५', steps)).toEqual({ ok: true, value: '2023-04-28', warnings: [] });
  });

  it('stops at the first failing step and names it', () => {
    const steps = [compile('trim'), compile('bsToAd'), compile('titleCase')];
    expect(runChain('2080/13/4', steps)).toEqual({
      ok: false,
      error: 'bsToAd: 2080-13-04 is not a real BS date',
    });
  });

  it('prefixes warnings with the step that raised them', () => {
    expect(runChain('Ram', [compile('namePart', { part: 'last' })])).toEqual({
      ok: true,
      value: '',
      warnings: ['namePart: name has no last name'],
    });
  });

  it('rejects an unknown transform name', () => {
    expect(compileStep({ name: 'guessGender' })).toEqual({
      error: 'unknown transform "guessGender"',
    });
  });

  it('rejects invalid or unexpected args', () => {
    expect(compileStep({ name: 'namePart', args: { part: 'nickname' } })).toHaveProperty('error');
    expect(compileStep({ name: 'trim', args: { aggressive: true } })).toHaveProperty('error');
    expect(compileStep({ name: 'mapValues', args: { values: {} } })).toHaveProperty('error');
  });
});

describe('mapValues', () => {
  const gender = { values: { M: 'male', Purush: 'male', F: 'female', Mahila: 'female' } };

  it('maps codes case-insensitively by default', () => {
    expect(mapValues('purush', gender)).toMatchObject({ ok: true, value: 'male' });
    expect(mapValues(' f ', gender)).toMatchObject({ ok: true, value: 'female' });
  });

  it('fails on a code that is not in the table instead of guessing', () => {
    expect(mapValues('X', gender).ok).toBe(false);
  });

  it('passes blank input through', () => {
    expect(mapValues('', gender)).toMatchObject({ ok: true, value: '' });
  });
});

describe('titleCase', () => {
  it('capitalizes each word and collapses spaces', () => {
    expect(titleCase('  RAM   bahadur THAPA ')).toMatchObject({ value: 'Ram Bahadur Thapa' });
  });

  it('leaves Devanagari unchanged', () => {
    expect(titleCase('राम थापा')).toMatchObject({ value: 'राम थापा' });
  });
});

describe('namePart', () => {
  it('returns the requested part of a full name', () => {
    expect(namePart('Ram Bahadur Thapa', { part: 'middle' })).toMatchObject({ value: 'Bahadur' });
  });
});
