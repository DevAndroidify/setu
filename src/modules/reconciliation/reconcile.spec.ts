import fc from 'fast-check';
import {
  buildReport,
  columnChecksum,
  FieldValues,
  LoadedPair,
  reportToCsv,
  samplePairs,
} from './reconcile';

const person = (n: number): FieldValues => ({
  name_ne: `राम ${n}`,
  name_en: `Ram ${n}`,
  gender: n % 2 ? 'male' : 'female',
  dob_ad: '1987-07-12',
  citizenship_no: `99-01-01-${String(n).padStart(5, '0')}`,
  father_name_ne: null,
});

const pairs = (n: number): LoadedPair[] =>
  Array.from({ length: n }, (_, i) => ({ rowNo: i + 1, staged: person(i), target: person(i) }));

const input = (overrides: Partial<Parameters<typeof buildReport>[0]> = {}) => ({
  runId: 'run-1',
  mode: 'production' as const,
  profiledRows: 110,
  extractedRows: 110,
  statusCounts: { valid: 0, quarantined: 10, duplicate_review: 0, loaded: 100 },
  pairs: pairs(100),
  ...overrides,
});

describe('columnChecksum', () => {
  it('does not depend on row order', () => {
    fc.assert(
      fc.property(fc.array(fc.option(fc.string(), { nil: null })), (values) => {
        return columnChecksum(values) === columnChecksum([...values].reverse());
      }),
    );
  });

  it('tells null apart from an empty string', () => {
    expect(columnChecksum([null])).not.toBe(columnChecksum(['']));
  });
});

describe('buildReport', () => {
  it('reports a clean, balanced run as ok', () => {
    const report = buildReport(input());
    expect(report.ok).toBe(true);
    expect(report.counts).toMatchObject({ balanced: true, problems: [] });
    expect(report.checksums!.every((c) => c.match)).toBe(true);
    expect(report.sample!.size).toBe(20); // 1% of 100 is below the minimum of 20
  });

  it('flags rows that are not accounted for', () => {
    const report = buildReport(input({ extractedRows: 111, profiledRows: 111 }));
    expect(report.ok).toBe(false);
    expect(report.counts.balanced).toBe(false);
    expect(report.counts.problems).toContain('110 rows are accounted for but 111 were extracted');
  });

  it('flags a difference between the profiler count and the extracted rows', () => {
    const report = buildReport(input({ profiledRows: 109 }));
    expect(report.counts.problems[0]).toMatch(/profiler counted 109 rows but 110/);
  });

  it('catches a value changed during load in the column checksum and the sample', () => {
    const changed = pairs(100).map((p) => ({
      ...p,
      target: { ...p.target!, dob_ad: '1987-07-13' },
    }));
    const report = buildReport(input({ pairs: changed }));
    expect(report.checksums!.find((c) => c.field === 'dob_ad')!.match).toBe(false);
    expect(report.checksums!.find((c) => c.field === 'name_ne')!.match).toBe(true);
    expect(report.sample!.mismatches).toHaveLength(20);
    expect(report.sample!.mismatches[0]).toMatchObject({ field: 'dob_ad', target: '1987-07-13' });
  });

  it('treats a loaded row with no target record as a mismatch', () => {
    const missing = pairs(100).map((p, i) => (i === 0 ? { ...p, target: null } : p));
    expect(buildReport(input({ pairs: missing })).ok).toBe(false);
  });

  it('balances a dry run on valid + quarantined, without checksums', () => {
    const report = buildReport(
      input({
        mode: 'dry_run',
        pairs: [],
        statusCounts: { valid: 100, quarantined: 10, duplicate_review: 0, loaded: 0 },
      }),
    );
    expect(report).toMatchObject({ ok: true, checksums: null, sample: null });
  });
});

describe('samplePairs', () => {
  it('samples 1% of a large run, the same rows every time', () => {
    const big = pairs(5000);
    const first = samplePairs('run-1', big).map((p) => p.rowNo);
    expect(first).toHaveLength(50);
    expect(samplePairs('run-1', big).map((p) => p.rowNo)).toEqual(first);
    expect(samplePairs('run-2', big).map((p) => p.rowNo)).not.toEqual(first);
  });
});

describe('reportToCsv', () => {
  it('neutralizes values a spreadsheet would run as formulas', () => {
    const evil = pairs(1).map((p) => ({
      ...p,
      staged: { ...p.staged, name_en: '=HYPERLINK("http://x","click")' },
    }));
    const csv = reportToCsv(
      buildReport(
        input({
          pairs: evil,
          statusCounts: { valid: 0, quarantined: 109, duplicate_review: 0, loaded: 1 },
        }),
      ),
    );
    expect(csv).toContain(`"'=HYPERLINK(""http://x"",""click"")"`);
    expect(csv).not.toMatch(/(^|,)=HYPERLINK/m);
  });

  it('lists counts and one checksum line per column', () => {
    const csv = reportToCsv(buildReport(input()));
    expect(csv.split('\r\n')[0]).toBe('section,item,source,target,result');
    expect(csv).toContain('counts,loaded,100,,');
    expect(csv.match(/^checksum,/gm)).toHaveLength(6);
  });
});
