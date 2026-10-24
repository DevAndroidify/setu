import { generateRegister } from '../../../tools/generate-legacy-data';
import { FileProfiler, looksLikePreeti, shapeOf } from './column-profiler';

describe('looksLikePreeti', () => {
  it.each(['bLks yfkf', '/fd vgfn', ';l/tf a/fn', 'dfof yfkf', 'ladnf zfx', 'g]kfn'])(
    'recognizes the Preeti text %s',
    (value) => {
      expect(looksLikePreeti(value)).toBe(true);
    },
  );

  it.each([
    'Dipak Thapa',
    'RAM KHANAL',
    'Shyam Shah',
    'Naya Bazar',
    'Sitapaila VDC',
    'M',
    '2045/3/12',
    '85-07-47-78354',
  ])('does not flag ordinary text or numbers like %s', (value) => {
    expect(looksLikePreeti(value)).toBe(false);
  });
});

describe('shapeOf', () => {
  it('reduces values to their shape', () => {
    expect(shapeOf('2045/3/12')).toBe('9999/9/99');
    expect(shapeOf('२०४५-०३-१२')).toBe('९९९९-९९-९९');
    expect(shapeOf('Ram  Thapa')).toBe('a a');
    expect(shapeOf('राम थापा')).toBe('क क');
  });
});

describe('FileProfiler', () => {
  const profile = (encoding: 'cp1252' | 'utf8') => {
    const register = generateRegister({ rows: 1000, seed: 42, encoding });
    const profiler = new FileProfiler();
    for (const row of register.rows) {
      profiler.add(Object.fromEntries(register.header.map((h, i) => [h, row[i] ?? ''])));
    }
    const report = profiler.report('windows-1252');
    return (name: string) => report.columns.find((c) => c.name === name)!;
  };

  it('flags the Preeti name columns of the generated register and nothing else', () => {
    const column = profile('cp1252');
    expect(column('NAAM').preeti.likely).toBe(true);
    expect(column('BABU_NAAM').preeti.likely).toBe(true);
    for (const name of ['NAAM_EN', 'LINGA', 'JILLA', 'GABISA', 'TOLE', 'JANMA_MITI']) {
      expect(column(name).preeti.likely).toBe(false);
    }
  });

  it('detects every date format used in the date-of-birth column', () => {
    const formats = profile('cp1252')('JANMA_MITI').dateFormats.map((f) => f.format);
    expect(formats.sort()).toEqual(['D/M/YYYY', 'YYYY-MM-DD', 'YYYY.MM.DD', 'YYYY/M/D']);
  });

  it('counts dates written with Devanagari digits in the UTF-8 register', () => {
    const dob = profile('utf8')('JANMA_MITI');
    expect(dob.patterns.some((p) => p.pattern.includes('९'))).toBe(true);
    expect(dob.dateFormats.length).toBe(4);
  });

  it('reports empty values and numeric ranges', () => {
    const column = profile('cp1252');
    expect(column('JANMA_MITI').empty).toBeGreaterThan(0);
    expect(column('NAGARIKTA_NO').emptyPct).toBeGreaterThan(10);
    expect(column('SN').numeric).toEqual({ min: 1, max: 1000, mean: 500.5 });
  });

  it('caps the number of distinct values it tracks', () => {
    const profiler = new FileProfiler();
    for (let i = 0; i < 10_050; i++) profiler.add({ ID: String(i) });
    const id = profiler.report('utf-8').columns[0]!;
    expect(id.distinct).toBe(10_000);
    expect(id.distinctCapped).toBe(true);
  });

  it('counts rows whose field count differs from the header', () => {
    const profiler = new FileProfiler();
    profiler.add({ A: '1', B: '2' });
    profiler.add({ A: '1' });
    expect(profiler.report('utf-8')).toMatchObject({ rowCount: 2, raggedRows: 1 });
  });
});
