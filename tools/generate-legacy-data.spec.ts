import { encodeCp1252, generateRegister } from './generate-legacy-data';

const column = (header: string[], name: string): number => header.indexOf(name);

describe('generateRegister', () => {
  it('produces the same Windows-1252 register for a fixed seed', () => {
    const register = generateRegister({ rows: 30, seed: 42, encoding: 'cp1252' });
    expect(register.csv).toMatchSnapshot();
    expect(register.truth).toMatchSnapshot();
  });

  it('produces the same UTF-8 register for a fixed seed', () => {
    const register = generateRegister({ rows: 30, seed: 42, encoding: 'utf8' });
    expect(register.csv).toMatchSnapshot();
  });

  it('holds the same people and problems in both encodings for one seed', () => {
    const cp1252 = generateRegister({ rows: 500, seed: 42, encoding: 'cp1252' });
    const utf8 = generateRegister({ rows: 500, seed: 42, encoding: 'utf8' });
    const nameEn = column(cp1252.header, 'NAAM_EN');
    expect(utf8.rows.map((r) => r[nameEn])).toEqual(cp1252.rows.map((r) => r[nameEn]));
    expect({ ...utf8.truth, encoding: 'cp1252' }).toEqual(cp1252.truth);
  });

  it('produces different data for a different seed', () => {
    const a = generateRegister({ rows: 30, seed: 1, encoding: 'cp1252' });
    const b = generateRegister({ rows: 30, seed: 2, encoding: 'cp1252' });
    expect(a.csv).not.toEqual(b.csv);
  });

  it('writes exactly the requested number of rows with CRLF line endings', () => {
    const register = generateRegister({ rows: 250, seed: 7, encoding: 'cp1252' });
    expect(register.rows).toHaveLength(250);
    expect(register.csv.split('\r\n')).toHaveLength(252); // header + rows + trailing newline
  });

  it('plants every anomaly kind and some duplicates in a large register', () => {
    const { truth } = generateRegister({ rows: 2000, seed: 42, encoding: 'cp1252' });
    const kinds = new Set(truth.anomalies.map((a) => a.kind));
    expect([...kinds].sort()).toEqual([
      'ad_dob',
      'bad_citizenship',
      'impossible_dob',
      'invalid_ward',
      'missing_dob',
    ]);
    expect(truth.duplicates.length).toBeGreaterThan(50);
  });

  it('records duplicates that point to an earlier row of the same person', () => {
    const { header, rows, truth } = generateRegister({ rows: 2000, seed: 42, encoding: 'cp1252' });
    const name = column(header, 'NAAM');
    const father = column(header, 'BABU_NAAM');
    for (const { row, duplicateOf } of truth.duplicates) {
      expect(duplicateOf).toBeLessThan(row);
      const dup = rows[row - 1];
      const original = rows[duplicateOf - 1];
      expect(dup?.[name]).toEqual(original?.[name]);
      expect(dup?.[father]).toEqual(original?.[father]);
    }
  });

  it('keeps Windows-1252 output free of Devanagari, using Preeti for Nepali names', () => {
    const { csv } = generateRegister({ rows: 500, seed: 42, encoding: 'cp1252' });
    expect(csv).not.toMatch(/[ऀ-ॿ]/);
    expect(() => encodeCp1252(csv)).not.toThrow();
  });

  it('uses Devanagari names and some Devanagari digits in UTF-8 output', () => {
    const { header, rows } = generateRegister({ rows: 500, seed: 42, encoding: 'utf8' });
    const dob = column(header, 'JANMA_MITI');
    expect(rows[0]?.[column(header, 'NAAM')]).toMatch(/[ऀ-ॿ]/);
    expect(rows.some((r) => /[०-९]/.test(r[dob] ?? ''))).toBe(true);
    expect(rows.some((r) => /^[0-9]/.test(r[dob] ?? ''))).toBe(true);
  });
});

describe('encodeCp1252', () => {
  it('maps curly quotes and the en dash to their Windows-1252 bytes', () => {
    expect([...encodeCp1252('‘a’–')]).toEqual([0x91, 0x61, 0x92, 0x96]);
  });

  it('keeps Latin-1 characters as single bytes', () => {
    expect([...encodeCp1252('é')]).toEqual([0xe9]);
  });

  it('refuses characters Windows-1252 cannot represent', () => {
    expect(() => encodeCp1252('राम')).toThrow(/U\+930/);
  });
});
