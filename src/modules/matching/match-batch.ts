import { AUTO_LINK, bestMatch, MatchFeatures, MatchRecord, prepare, PreparedRecord } from './score';

export type MatchInput = {
  id: bigint;
  rawRowId: bigint;
  block: string | null;
  record: MatchRecord;
};

/** An earlier row: `personId` is set when it is already a person in target. */
export type MatchCandidateInput = MatchInput & { personId: string | null };

export type MatchOutcome =
  | { row: MatchInput; kind: 'new' }
  | {
      row: MatchInput;
      kind: 'link' | 'review';
      candidate: MatchCandidateInput;
      score: number;
      features: MatchFeatures;
    };

/**
 * Pure: decides, for each row of a batch in order, whether it is a new person, the same person
 * as an earlier row (link) or possibly the same (review). Earlier rows are the given
 * candidates plus the rows before it in this batch that turned out to be new people. Rows are
 * compared only within their block, or when they share a citizenship number.
 */
export function matchBatch(rows: MatchInput[], candidates: MatchCandidateInput[]): MatchOutcome[] {
  type Prepared = MatchCandidateInput & { prepared: PreparedRecord };
  const byBlock = new Map<string, Prepared[]>();
  const byCitizenship = new Map<string, Prepared[]>();
  const add = (input: MatchCandidateInput, prepared = prepare(input.record)) => {
    const c = { ...input, prepared };
    if (c.block) byBlock.set(c.block, [...(byBlock.get(c.block) ?? []), c]);
    const no = c.record.citizenship_no;
    if (no) byCitizenship.set(no, [...(byCitizenship.get(no) ?? []), c]);
  };
  for (const c of candidates) add(c);

  return rows.map((row): MatchOutcome => {
    const pool = new Set([
      ...(row.block ? (byBlock.get(row.block) ?? []) : []),
      ...(row.record.citizenship_no ? (byCitizenship.get(row.record.citizenship_no) ?? []) : []),
    ]);
    const prepared = prepare(row.record);
    const best = bestMatch(prepared, [...pool]);
    if (!best) {
      add({ ...row, personId: null }, prepared);
      return { row, kind: 'new' };
    }
    const { prepared: _prepared, ...candidate } = best.candidate;
    return {
      row,
      kind: best.score >= AUTO_LINK ? 'link' : 'review',
      candidate,
      score: best.score,
      features: best.features,
    };
  });
}
