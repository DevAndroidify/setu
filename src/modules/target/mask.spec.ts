import fc from 'fast-check';
import { maskCitizenshipNo } from './mask';

describe('maskCitizenshipNo', () => {
  it('shows only the last five digits, keeping the dashes', () => {
    expect(maskCitizenshipNo('27-01-71-12345')).toBe('**-**-**-12345');
    expect(maskCitizenshipNo('8-1-5-123456')).toBe('*-*-*-*23456');
  });

  it('hides a short number completely and passes a missing one through', () => {
    expect(maskCitizenshipNo('1234')).toBe('****');
    expect(maskCitizenshipNo(null)).toBeNull();
  });

  it('never reveals more than the last five characters of any number', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 6, maxLength: 30 }), (value) => {
        const masked = maskCitizenshipNo(value)!;
        expect(masked.endsWith(value.slice(-5))).toBe(true);
        expect(masked.slice(0, -5)).toMatch(/^[*-]*$/);
      }),
    );
  });
});
