import reference from '../../../prisma/reference/address.json';
import spec from '../../../test/fixtures/mappings/household-register.v1.json';
import { generateRegister } from '../../../tools/generate-legacy-data';
import { buildAddressReference } from '../transforms';
import { compileMapping, mapRow, MappedRow } from './mapping-engine';
import { mappingSpecSchema } from './mapping-spec';

const ctx = { today: '2026-10-24' };
const mapping = compileMapping(
  mappingSpecSchema.parse(spec),
  buildAddressReference(reference.localUnits, reference.legacyVdcs),
);

// The same seed gives the same people in both encodings, so the UTF-8 file holds the exact
// Devanagari each Preeti name must convert to.
const cp1252 = generateRegister({ rows: 500, seed: 42, encoding: 'cp1252' });
const utf8 = generateRegister({ rows: 500, seed: 42, encoding: 'utf8' });
const asRecord = (row: string[]) =>
  Object.fromEntries(cp1252.header.map((h, i) => [h, row[i] ?? '']));
const mapped: MappedRow[] = cp1252.rows.map((row) => mapRow(asRecord(row), mapping, ctx));

const rowsWith = (kind: string) =>
  cp1252.truth.anomalies.filter((a) => a.kind === kind).map((a) => a.row);
const fieldErrors = (row: number, field: string) =>
  mapped[row - 1]!.errors.filter((e) => e.field === field);

describe('mapRow with the household register mapping', () => {
  it('converts every Preeti name to the Devanagari the generator intended', () => {
    const NAAM = cp1252.header.indexOf('NAAM');
    const BABU = cp1252.header.indexOf('BABU_NAAM');
    mapped.forEach((row, i) => {
      expect(row.values.name_ne).toBe(utf8.rows[i]![NAAM]);
      expect(row.values.father_name_ne).toBe(utf8.rows[i]![BABU]);
    });
  });

  it('normalizes gender spellings and English name case', () => {
    expect(new Set(mapped.map((r) => r.values.gender))).toEqual(new Set(['male', 'female']));
    for (const row of mapped) expect(row.values.name_en).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
  });

  it('quarantines rows with an impossible BS date of birth', () => {
    const rows = rowsWith('impossible_dob');
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(fieldErrors(row, 'dob_ad')[0]?.message).toMatch(/is not a real BS date/);
    }
  });

  it('quarantines rows with a malformed citizenship number', () => {
    const rows = rowsWith('bad_citizenship');
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(fieldErrors(row, 'citizenship_no')[0]?.message).toMatch(/citizenshipFormat/);
    }
  });

  // An AD year from 2000 on is also a real BS year (2005 BS = 1948 AD), so those mistakes
  // cannot be told apart from the value alone; earlier AD years can.
  const JANMA_MITI = cp1252.header.indexOf('JANMA_MITI');
  const adYear = (row: number) => Number(cp1252.rows[row - 1]![JANMA_MITI]!.slice(0, 4));
  const dobIssues = (row: number) =>
    [...mapped[row - 1]!.errors, ...mapped[row - 1]!.warnings].filter((i) => i.field === 'dob_ad');

  it('flags an AD date typed into the BS field when its year cannot be a plausible BS year', () => {
    const detectable = rowsWith('ad_dob').filter((row) => adYear(row) < 2000);
    expect(detectable.length).toBeGreaterThan(0);
    for (const row of detectable) expect(dobIssues(row).length).toBeGreaterThan(0);
  });

  it('cannot flag an AD date whose year is also a plausible BS year (known limit)', () => {
    const ambiguous = rowsWith('ad_dob').filter((row) => adYear(row) >= 2000);
    for (const row of ambiguous) expect(dobIssues(row)).toEqual([]);
  });

  it('keeps a missing date of birth as empty without failing the row', () => {
    for (const row of rowsWith('missing_dob')) {
      expect(mapped[row - 1]!.values.dob_ad).toBeNull();
      expect(fieldErrors(row, 'dob_ad')).toEqual([]);
    }
  });

  const GABISA = cp1252.header.indexOf('GABISA');
  const inBhalam = (row: number) => /bhalam/i.test(cp1252.rows[row - 1]![GABISA]!);

  it('places each household in the local unit that replaced its VDC', () => {
    const units = new Set(mapped.map((r) => r.values.local_unit_code).filter(Boolean));
    expect(units).toEqual(
      new Set([
        'kaski-pokhara',
        'kaski-annapurna',
        'chitwan-bharatpur',
        'kathmandu-nagarjun',
        'kathmandu-chandragiri',
        'kathmandu-gokarneshwor',
      ]),
    );
  });

  it('sends every row from a VDC that was split across units to review', () => {
    const rows = mapped.map((_, i) => i + 1).filter(inBhalam);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(fieldErrors(row, 'local_unit_code')[0]?.message).toMatch(/needs review/);
    }
  });

  it('quarantines rows whose ward does not exist in the old VDC', () => {
    const rows = rowsWith('invalid_ward');
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(fieldErrors(row, 'ward_no').length).toBeGreaterThan(0);
  });

  it('accepts every row with no planted problem', () => {
    const planted = new Set(
      cp1252.truth.anomalies
        .filter((a) => !(a.kind === 'ad_dob' && adYear(a.row) >= 2000))
        .map((a) => a.row),
    );
    const clean = mapped.filter((_, i) => !planted.has(i + 1) && !inBhalam(i + 1));
    expect(clean.length).toBeGreaterThan(350);
    for (const row of clean) expect(row).toMatchObject({ status: 'valid', errors: [] });
  });

  it('reports every failing field of a row, not just the first', () => {
    const row = mapRow(
      {
        NAAM: '',
        NAAM_EN: '',
        LINGA: 'X',
        JANMA_MITI: '2080/13/1',
        NAGARIKTA_NO: '1',
        BABU_NAAM: '',
      },
      mapping,
      ctx,
    );
    expect(row.errors.map((e) => e.field).sort()).toEqual([
      'citizenship_no',
      'dob_ad',
      'gender',
      'local_unit_code',
      'name_en',
      'name_ne',
      'ward_no',
    ]);
  });

  it('requires a complete address when a row has a household number', () => {
    const row = mapRow(
      { NAAM: ';Ltf', NAAM_EN: 'Sita', GHAR_NO: '7', JILLA: '', GABISA: '', WARD_NO: '' },
      mapping,
      ctx,
    );
    expect(row.errors.map((e) => [e.field, e.message])).toEqual([
      ['local_unit_code', 'required: is required'],
      ['ward_no', 'required: is required'],
    ]);
  });
});

describe('mappingSpecSchema', () => {
  it('accepts the household register mapping', () => {
    expect(mappingSpecSchema.safeParse(spec).success).toBe(true);
  });

  it('rejects unknown transforms, bad rules, duplicate and missing required targets', () => {
    const result = mappingSpecSchema.safeParse({
      fields: [
        { target: 'person.name_ne', from: ['A'], transforms: [{ name: 'magic' }] },
        { target: 'person.name_ne', from: ['B'], rules: ['after:someday'] },
      ],
    });
    expect(result.success).toBe(false);
    const messages = result.error!.issues.map((i) => i.message).join(' | ');
    expect(messages).toContain('unknown transform "magic"');
    expect(messages).toContain('after needs a date');
    expect(messages).toContain('is mapped twice');
    expect(messages).toContain('person.name_en must be mapped');
  });
});
