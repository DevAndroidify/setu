import { AUTO_LINK, bestMatch, MatchFeatures, MatchRecord } from './score';

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
  const byBlock = new Map<string, MatchCandidateInput[]>();
  const byCitizenship = new Map<string, MatchCandidateInput[]>();
  const add = (c: MatchCandidateInput) => {
    if (c.block) byBlock.set(c.block, [...(byBlock.get(c.block) ?? []), c]);
    const no = c.record.citizenship_no;
    if (no) byCitizenship.set(no, [...(byCitizenship.get(no) ?? []), c]);
  };
  candidates.forEach(add);

  return rows.map((row): MatchOutcome => {
    const pool = new Set([
      ...(row.block ? (byBlock.get(row.block) ?? []) : []),
      ...(row.record.citizenship_no ? (byCitizenship.get(row.record.citizenship_no) ?? []) : []),
    ]);
    const best = bestMatch(row.record, [...pool]);
    if (!best) {
      add({ ...row, personId: null });
      return { row, kind: 'new' };
    }
    return {
      row,
      kind: best.score >= AUTO_LINK ? 'link' : 'review',
      candidate: best.candidate,
      score: best.score,
      features: best.features,
    };
  });
}
