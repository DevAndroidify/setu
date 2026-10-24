import { MatchInput, matchBatch } from './match-batch';
import { MatchRecord } from './score';

let nextId = 1n;
const row = (over: Partial<MatchRecord> = {}, block: string | null = 'kaski|1988'): MatchInput => {
  const id = nextId++;
  return {
    id,
    rawRowId: id,
    block,
    record: {
      name_ne: 'राम थापा',
      name_en: 'Ram Thapa',
      dob_ad: '1988-04-12',
      father_name_ne: 'हरि थापा',
      citizenship_no: null,
      ...over,
    },
  };
};

describe('matchBatch', () => {
  it('links a row re-entered later in the same batch to the first entry', () => {
    const first = row();
    const again = row({ name_en: 'Raam Thappa' });
    const [a, b] = matchBatch([first, again], []);
    expect(a).toEqual({ row: first, kind: 'new' });
    expect(b).toMatchObject({ kind: 'link', candidate: { id: first.id } });
  });

  it('links to a person already in target, keeping that person', () => {
    const existing = { ...row(), personId: 'p-1' };
    const [outcome] = matchBatch([row()], [existing]);
    expect(outcome).toMatchObject({ kind: 'link', candidate: { personId: 'p-1' } });
  });

  it('only compares rows within the same block', () => {
    const existing = { ...row({}, 'chitwan|1988'), personId: 'p-1' };
    expect(matchBatch([row()], [existing])[0]!.kind).toBe('new');
  });

  it('compares rows that share a citizenship number across blocks, and holds them for review', () => {
    const existing = {
      ...row({ citizenship_no: '85-01-50-00001', dob_ad: null }, null),
      personId: 'p-1',
    };
    const [outcome] = matchBatch([row({ citizenship_no: '85-01-50-00001' })], [existing]);
    expect(outcome).toMatchObject({ kind: 'review', features: { citizenship: 'same' } });
  });

  it('does not offer a held or linked row as a candidate for later rows', () => {
    const existing = { ...row(), personId: 'p-1' };
    const outcomes = matchBatch([row(), row()], [existing]);
    for (const o of outcomes) expect(o).toMatchObject({ candidate: { personId: 'p-1' } });
  });
});
