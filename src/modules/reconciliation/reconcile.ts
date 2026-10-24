import { createHash } from 'node:crypto';
import { PERSON_FIELDS, type PersonField } from '../validation';

/**
 * Builds a run's reconciliation report (pure: all data comes in as arguments). It proves three
 * things: every source row is accounted for, every loaded column arrived unchanged (checksums),
 * and a random sample of rows matches field by field.
 */

export type FieldValues = Record<PersonField, string | null>;

/** A loaded row: what staging said should be loaded and what target holds (null = missing). */
export type LoadedPair = { rowNo: number; staged: FieldValues; target: FieldValues | null };

export type ReconcileInput = {
  runId: string;
  mode: 'dry_run' | 'production';
  /** Rows the profiler counted when the file was uploaded: an independent count. */
  profiledRows: number | null;
  extractedRows: number;
  statusCounts: {
    valid: number;
    quarantined: number;
    duplicate_review: number;
    loaded: number;
    linked: number;
  };
  pairs: LoadedPair[];
};

export type ReconciliationReport = {
  runId: string;
  mode: 'dry_run' | 'production';
  ok: boolean;
  counts: {
    profiled: number | null;
    extracted: number;
    loaded: number;
    /** Rows that are a person already in target: lineage only, no new record. */
    linked: number;
    quarantined: number;
    pendingReview: number;
    /** Valid but not loaded (dry runs). */
    valid: number;
    balanced: boolean;
    problems: string[];
  };
  checksums: { field: PersonField; source: string; target: string; match: boolean }[] | null;
  sample: {
    size: number;
    rowNos: number[];
    mismatches: {
      rowNo: number;
      field: PersonField;
      source: string | null;
      target: string | null;
    }[];
  } | null;
};

const SAMPLE_RATE = 0.01;
const SAMPLE_MIN = 20;
const NULL_MARK = '␀'; // keeps null distinct from an empty string in the checksum

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

/** Order-independent checksum of one column: the hash of its sorted values. */
export function columnChecksum(values: (string | null)[]): string {
  return sha256(
    values
      .map((v) => v ?? NULL_MARK)
      .sort()
      .join('\n'),
  );
}

/** A random but reproducible sample: the same run always samples the same rows. */
export function samplePairs(runId: string, pairs: LoadedPair[]): LoadedPair[] {
  const size = Math.min(pairs.length, Math.max(SAMPLE_MIN, Math.ceil(pairs.length * SAMPLE_RATE)));
  return pairs
    .map((pair) => ({ pair, key: sha256(`${runId}:${pair.rowNo}`) }))
    .sort((a, b) => (a.key < b.key ? -1 : 1))
    .slice(0, size)
    .map((s) => s.pair)
    .sort((a, b) => a.rowNo - b.rowNo);
}

export function buildReport(input: ReconcileInput): ReconciliationReport {
  const { statusCounts: s, extractedRows } = input;
  const problems: string[] = [];
  if (input.profiledRows !== null && input.profiledRows !== extractedRows) {
    problems.push(
      `the profiler counted ${input.profiledRows} rows but ${extractedRows} were extracted`,
    );
  }
  const accounted =
    (input.mode === 'production' ? s.loaded + s.linked : s.valid) +
    s.quarantined +
    s.duplicate_review;
  const balanced =
    accounted === extractedRows &&
    (input.profiledRows === null || input.profiledRows === extractedRows);
  if (accounted !== extractedRows) {
    problems.push(`${accounted} rows are accounted for but ${extractedRows} were extracted`);
  }
  if (input.mode === 'production' && s.valid > 0) {
    problems.push(`${s.valid} valid rows were never loaded`);
  }
  if (input.mode === 'production' && input.pairs.length !== s.loaded) {
    problems.push(`${s.loaded} rows are marked loaded but ${input.pairs.length} have lineage`);
  }

  let checksums: ReconciliationReport['checksums'] = null;
  let sample: ReconciliationReport['sample'] = null;
  if (input.mode === 'production') {
    checksums = PERSON_FIELDS.map((field) => {
      const source = columnChecksum(input.pairs.map((p) => p.staged[field]));
      const target = columnChecksum(input.pairs.map((p) => p.target?.[field] ?? null));
      return { field, source, target, match: source === target };
    });
    for (const c of checksums.filter((c) => !c.match)) {
      problems.push(`column ${c.field} differs between staging and target`);
    }

    const sampled = samplePairs(input.runId, input.pairs);
    const mismatches = sampled.flatMap((p) =>
      PERSON_FIELDS.filter((f) => p.staged[f] !== (p.target?.[f] ?? null)).map((field) => ({
        rowNo: p.rowNo,
        field,
        source: p.staged[field],
        target: p.target?.[field] ?? null,
      })),
    );
    sample = { size: sampled.length, rowNos: sampled.map((p) => p.rowNo), mismatches };
    if (mismatches.length) problems.push(`${mismatches.length} sampled fields differ`);
  }

  return {
    runId: input.runId,
    mode: input.mode,
    ok: problems.length === 0,
    counts: {
      profiled: input.profiledRows,
      extracted: extractedRows,
      loaded: s.loaded,
      linked: s.linked,
      quarantined: s.quarantined,
      pendingReview: s.duplicate_review,
      valid: s.valid,
      balanced,
      problems,
    },
    checksums,
    sample,
  };
}

/**
 * CSV for auditors who work in spreadsheets. Cells that a spreadsheet would run as a formula
 * (starting with = + - @ or a control character) are prefixed with an apostrophe.
 */
export function reportToCsv(report: ReconciliationReport): string {
  const cell = (value: unknown): string => {
    let text = value === null || value === undefined ? '' : String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const rows: unknown[][] = [['section', 'item', 'source', 'target', 'result']];
  const c = report.counts;
  rows.push(['summary', 'run', report.runId, report.mode, report.ok ? 'ok' : 'problems found']);
  rows.push(['counts', 'profiled', c.profiled, '', '']);
  rows.push(['counts', 'extracted', c.extracted, '', '']);
  rows.push(['counts', 'loaded', c.loaded, '', '']);
  rows.push(['counts', 'linked to existing', c.linked, '', '']);
  rows.push(['counts', 'quarantined', c.quarantined, '', '']);
  rows.push(['counts', 'pending review', c.pendingReview, '', '']);
  rows.push(['counts', 'valid (not loaded)', c.valid, '', '']);
  for (const problem of c.problems) rows.push(['problem', problem, '', '', '']);
  for (const k of report.checksums ?? []) {
    rows.push(['checksum', k.field, k.source, k.target, k.match ? 'match' : 'MISMATCH']);
  }
  if (report.sample) rows.push(['sample', 'rows compared', report.sample.size, '', '']);
  for (const m of report.sample?.mismatches ?? []) {
    rows.push(['sample mismatch', `row ${m.rowNo} ${m.field}`, m.source, m.target, 'MISMATCH']);
  }
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
