import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Batch, BatchStage, Run } from '@prisma/client';
import { createHash } from 'node:crypto';
import { ENV } from '../../shared/config/config.module';
import type { Env } from '../../shared/config/env.schema';
import { Metrics } from '../../shared/metrics/metrics';
import { AuditService } from '../audit';
import { LineageService } from '../lineage/lineage.service';
import {
  CompiledMapping,
  MappingsService,
  NormalizedRow,
  transformRow,
  validateRow,
} from '../mappings';
import {
  blockKey,
  matchBatch,
  MatchCandidateInput,
  MatchingService,
  MatchRecord,
} from '../matching';
import { QuarantineService } from '../quarantine/quarantine.service';
import type { FieldValues, LoadedPair } from '../reconciliation/reconcile';
import { ReconciliationService } from '../reconciliation/reconciliation.service';
import { RawRow, SourcesService } from '../sources';
import { personIdFor, RowValues, TargetService } from '../target/target.service';
import type { AddressReference } from '../transforms';
import { todayInNepal } from '../validation';
import { PipelineQueueService } from './pipeline-queue.service';
import { PipelineRepository, RunCounts, Tx } from './pipeline.repository';
import { RunEventsService } from './run-events.service';

export const runStream = (runId: string): string => `run:${runId}`;

/** Counts rows by outcome for the setu_rows_processed_total metric. */
type Tally = (status: string, rows: number) => void;
type StageWork = (tx: Tx, batch: Batch, run: Run, tally: Tally) => Promise<BatchStage>;

/**
 * The work of each pipeline stage, run by the worker. Every stage is one transaction that
 * first locks its batch and checks the batch is still at that stage, so a retried, duplicated
 * or resumed job finds the work done and stops: re-running a batch never changes the result.
 */
@Injectable()
export class StagesService {
  private readonly logger = new Logger(StagesService.name);
  private readonly compiled = new Map<string, CompiledMapping>();
  private reference?: Promise<AddressReference>;

  constructor(
    private readonly repo: PipelineRepository,
    private readonly queue: PipelineQueueService,
    private readonly sources: SourcesService,
    private readonly mappings: MappingsService,
    private readonly quarantine: QuarantineService,
    private readonly target: TargetService,
    private readonly lineage: LineageService,
    private readonly matching: MatchingService,
    private readonly reconciliation: ReconciliationService,
    private readonly audit: AuditService,
    private readonly metrics: Metrics,
    private readonly events: RunEventsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Streams the file into raw rows, one batch at a time, queuing each batch as it is cut. */
  async extract(runId: string): Promise<void> {
    const run = await this.repo.findRun(runId);
    if (!run) return;
    if (run.status === 'queued') {
      await this.repo.transaction((tx) =>
        this.repo.transition(tx, runId, ['queued'], 'running', { startedAt: new Date() }),
      );
    } else if (run.status !== 'running') {
      return; // paused or cancelled before it started
    }

    const file = await this.sources.getFile(run.sourceFileId);
    let seq = 0;
    let total = 0;
    let rows: RawRow[] = [];
    for await (const row of await this.sources.readRows(file)) {
      rows.push(row);
      total += 1;
      if (rows.length === this.env.PIPELINE_BATCH_SIZE) {
        await this.extractBatch(runId, ++seq, rows);
        rows = [];
        if (!(await this.isRunning(runId))) return; // paused or cancelled between batches
      }
    }
    if (rows.length) await this.extractBatch(runId, seq + 1, rows);
    await this.repo.setCounts(runId, { total });
    await this.finalizeIfDone(runId);
  }

  private async extractBatch(runId: string, seq: number, rows: RawRow[]): Promise<void> {
    const batch = await this.repo.transaction(async (tx) => {
      const b = await this.repo.upsertBatch(tx, runId, seq, rows[0]!.rowNo, rows.at(-1)!.rowNo);
      if (b.stage !== 'extract') return b; // extracted before a pause or crash
      await this.repo.insertRawRows(
        tx,
        rows.map((r) => ({
          runId,
          batchId: b.id,
          rowNo: r.rowNo,
          raw: r.values,
          rowHash: createHash('sha256').update(JSON.stringify(r.values)).digest('hex'),
        })),
      );
      await this.repo.setStage(tx, b.id, 'transform');
      return { ...b, stage: 'transform' as const };
    });
    if (batch.stage === 'transform') {
      this.metrics.rowsProcessed.inc({ stage: 'extract', status: 'extracted' }, rows.length);
    }
    await this.queue.batch(batch);
  }

  /** Transform: apply the pinned mapping's transform chains; failures go to quarantine. */
  transform(batchId: string): Promise<void> {
    return this.runStage('transform', batchId, async (tx, batch, run, tally) => {
      const mapping = await this.mapping(run.mappingId);
      const results = (await this.repo.rawRowsForBatch(tx, batch.id)).map((raw) => ({
        raw,
        out: transformRow(raw.raw as Record<string, string>, mapping),
      }));
      await this.repo.insertStagedRows(
        tx,
        results.map(({ raw, out }) => ({
          rawRowId: raw.id,
          normalized: out.values,
          warnings: out.warnings,
          status: out.errors.length ? 'quarantined' : 'valid',
        })),
      );
      const failed = results.filter((r) => r.out.errors.length);
      tally('valid', results.length - failed.length);
      tally('quarantined', failed.length);
      if (failed.length) {
        const staged = await this.repo.stagedRowsForBatch(tx, batch.id, 'quarantined');
        const idOf = new Map(staged.map((s) => [s.rawRowId, s.id]));
        await this.quarantine.record(
          tx,
          failed.map((f) => ({
            stagedRowId: idOf.get(f.raw.id)!,
            stage: 'transform',
            reasons: f.out.errors,
          })),
        );
      }
      return 'validate';
    });
  }

  /** Validate: field rules and the entity schema; every failing reason is kept. */
  validate(batchId: string): Promise<void> {
    return this.runStage('validate', batchId, async (tx, batch, run, tally) => {
      const mapping = await this.mapping(run.mappingId);
      const ctx = { today: todayInNepal() };
      const checked = (await this.repo.stagedRowsForBatch(tx, batch.id, 'valid')).map((s) => ({
        s,
        errors: validateRow(s.normalized as NormalizedRow, mapping, ctx),
      }));
      const failed = checked.filter((r) => r.errors.length);
      tally('valid', checked.length - failed.length);
      tally('quarantined', failed.length);
      await this.repo.setStagedStatus(
        tx,
        failed.map((f) => f.s.id),
        'quarantined',
      );
      await this.quarantine.record(
        tx,
        failed.map((f) => ({ stagedRowId: f.s.id, stage: 'validate', reasons: f.errors })),
      );
      return run.mode === 'dry_run' ? 'done' : 'match'; // dry runs stop before matching
    });
  }

  /**
   * Match: compares each valid row with earlier rows of the run and with persons already in
   * target, within its block (district + birth year) or by citizenship number. Batches match
   * in order, so "earlier" means earlier in the file and the result does not depend on timing:
   * a batch whose predecessor is still matching waits and is woken when it finishes.
   */
  match(batchId: string): Promise<void> {
    return this.runStage('match', batchId, async (tx, batch, run, tally) => {
      if (await this.repo.earlierBatchesUnmatched(tx, run.id, batch.seq)) return 'match';

      const ref = await this.addressReference();
      const toInput = (s: { id: bigint; rawRowId: bigint; normalized: unknown }) => {
        const values = s.normalized as RowValues;
        const district = values.local_unit_code
          ? (ref.districts.get(values.local_unit_code) ?? null)
          : null;
        return {
          id: s.id,
          rawRowId: s.rawRowId,
          block: blockKey(district, values.dob_ad),
          record: values as MatchRecord,
        };
      };
      const rows = (await this.repo.stagedRowsForBatch(tx, batch.id, 'valid')).map(toInput);
      const found = await this.repo.matchCandidates(
        tx,
        run.id,
        [...new Set(rows.map((r) => r.block).filter((b): b is string => b !== null))],
        rows.map((r) => r.record.citizenship_no).filter((n): n is string => !!n),
      );
      const persons = await this.lineage.personsForRawRows(
        found.filter((c) => c.status === 'loaded').map((c) => c.rawRowId),
      );
      const candidates: MatchCandidateInput[] = found.map((c) => ({
        ...toInput({ id: c.stagedRowId, rawRowId: c.rawRowId, normalized: c.normalized }),
        personId: persons.get(c.rawRowId) ?? null,
      }));
      const outcomes = matchBatch(rows, candidates);

      await this.repo.setBlockKeys(
        tx,
        rows.map((r) => ({ id: r.id, key: r.block })),
      );
      const matched = outcomes.filter((o) => o.kind !== 'new');
      await this.matching.record(
        tx,
        matched.map((o) => ({
          rowA: o.row.id,
          rowB: o.candidate.id,
          score: o.score,
          // The person the row would join: already in target, or an earlier row of this run
          // that its load will create.
          features: {
            ...o.features,
            personId: o.candidate.personId ?? personIdFor(o.candidate.rawRowId),
          },
          decision: o.kind === 'link' ? 'link' : 'pending',
        })),
      );
      const ids = (kind: 'link' | 'review') =>
        matched.filter((o) => o.kind === kind).map((o) => o.row.id);
      await this.repo.setStagedStatus(tx, ids('link'), 'linked');
      await this.repo.setStagedStatus(tx, ids('review'), 'duplicate_review');
      tally('new', rows.length - matched.length);
      tally('linked', ids('link').length);
      tally('review', ids('review').length);
      await this.audit.append(
        {
          stream: runStream(run.id),
          action: 'batch.matched',
          entity: 'batch',
          entityId: batch.id,
          payload: { seq: batch.seq, linked: ids('link').length, review: ids('review').length },
        },
        tx,
      );
      return 'load';
    });
  }

  /**
   * Load: insert persons, households and lineage in one transaction. A run's batches load one
   * at a time: batches loading together could each miss the other's citizenship numbers and
   * households, collide, and fail again on every retry.
   */
  load(batchId: string): Promise<void> {
    return this.runStage('load', batchId, async (tx, batch, run, tally) => {
      await this.repo.lockRun(tx, run.id, 'load');
      await this.linkMatchedRows(tx, batch, run);
      const staged = await this.repo.stagedRowsForBatch(tx, batch.id, 'valid');
      const values = (s: (typeof staged)[number]) => s.normalized as RowValues;

      // A citizenship number already in target (or twice in this batch) is a possible duplicate
      // person: hold it for review instead of loading a second record.
      const numbers = staged.map((s) => values(s).citizenship_no).filter((n): n is string => !!n);
      const taken = await this.target.existingCitizenshipNos(tx, numbers);
      const seen = new Set<string>();
      const conflicts: typeof staged = [];
      const loadable: typeof staged = [];
      for (const s of staged) {
        const number = values(s).citizenship_no;
        if (number && (taken.has(number) || seen.has(number))) {
          conflicts.push(s);
        } else {
          if (number) seen.add(number);
          loadable.push(s);
        }
      }
      await this.repo.setStagedStatus(
        tx,
        conflicts.map((s) => s.id),
        'quarantined',
      );
      await this.quarantine.record(
        tx,
        conflicts.map((s) => ({
          stagedRowId: s.id,
          stage: 'load',
          reasons: [
            {
              field: 'citizenship_no',
              stage: 'load',
              message:
                'citizenship number already belongs to another record; needs duplicate review',
            },
          ],
        })),
      );

      const personIds = await this.target.insertPersons(
        tx,
        run.id,
        loadable.map((s) => ({ rawRowId: s.rawRowId, values: values(s) })),
      );
      await this.lineage.record(
        tx,
        loadable.map((s) => ({
          targetTable: 'persons',
          targetId: personIds.get(s.rawRowId)!,
          rawRowId: s.rawRowId,
          mappingId: run.mappingId,
          runId: run.id,
          batchId: batch.id,
        })),
      );
      await this.repo.setStagedStatus(
        tx,
        loadable.map((s) => s.id),
        'loaded',
      );
      tally('loaded', loadable.length);
      tally('quarantined', conflicts.length);
      await this.audit.append(
        {
          stream: runStream(run.id),
          action: 'batch.loaded',
          entity: 'batch',
          entityId: batch.id,
          payload: { seq: batch.seq, loaded: loadable.length, quarantined: conflicts.length },
        },
        tx,
      );
      return 'done';
    });
  }

  /** Rows the matcher linked to an existing person get lineage to that person, not a new one. */
  private async linkMatchedRows(tx: Tx, batch: Batch, run: Run): Promise<void> {
    const linked = await this.repo.stagedRowsForBatch(tx, batch.id, 'linked');
    const personOf = await this.matching.linkedPersons(
      tx,
      linked.map((s) => s.id),
    );
    await this.lineage.record(
      tx,
      linked.map((s) => ({
        targetTable: 'persons',
        targetId: personOf.get(s.id)!,
        rawRowId: s.rawRowId,
        mappingId: run.mappingId,
        runId: run.id,
        batchId: batch.id,
      })),
    );
  }

  /** Completes the run once every batch is done and the extract has counted all rows. */
  async finalizeIfDone(runId: string): Promise<void> {
    const run = await this.repo.findRun(runId);
    const total = (run?.counts as RunCounts | undefined)?.total;
    if (!run || run.status !== 'running' || total === undefined) return;
    if ((await this.repo.countUnfinishedBatches(runId)) > 0) return;

    const staged = await this.repo.stagedCounts(runId);
    const counts: RunCounts = {
      total,
      loaded: staged.loaded,
      linked: staged.linked,
      quarantined: staged.quarantined,
      review: staged.duplicate_review,
      valid: staged.valid,
    };
    const loaded = run.mode === 'production' ? await this.repo.loadedRows(run.id) : [];
    const report = await this.reconcile(run, total, staged, loaded);
    const done = await this.repo.transaction(async (tx) => {
      const completed = await this.repo.transition(tx, runId, ['running'], 'completed', {
        finishedAt: new Date(),
        counts,
      });
      if (completed) {
        await this.target.setHouseholdHeads(
          tx,
          runId,
          loaded.map((r) => ({
            rawRowId: r.rawRowId,
            householdNo: (r.normalized as RowValues).household_no ?? null,
          })),
        );
        await this.reconciliation.save(tx, runId, report);
        await this.audit.append(
          {
            stream: runStream(runId),
            action: 'run.completed',
            entity: 'run',
            entityId: runId,
            payload: { ...counts, reconciled: report.ok, problems: report.counts.problems },
          },
          tx,
        );
      }
      return completed;
    });
    if (done) await this.events.publish(runId, { type: 'run', status: 'completed' });
  }

  /** Reconcile stage: staging against target, read back independently. */
  private async reconcile(
    run: Run,
    extractedRows: number,
    statusCounts: Awaited<ReturnType<PipelineRepository['stagedCounts']>>,
    loaded: Awaited<ReturnType<PipelineRepository['loadedRows']>>,
  ) {
    const file = await this.sources.getFile(run.sourceFileId);
    const pairs: LoadedPair[] = [];
    if (run.mode === 'production') {
      const [personOf, stored] = await Promise.all([
        this.lineage.personsForRun(run.id),
        this.target.valuesForRun(run.id),
      ]);
      for (const row of loaded) {
        const personId = personOf.get(row.rawRowId);
        pairs.push({
          rowNo: row.rowNo,
          staged: row.normalized as FieldValues,
          target: (personId && stored.get(personId)) || null,
        });
      }
    }
    return this.reconciliation.build({
      runId: run.id,
      mode: run.mode,
      profiledRows: file.rowCount,
      extractedRows,
      statusCounts,
      pairs,
    });
  }

  /** A job ran out of retries: the batch and its run are failed and the reason kept. */
  async fail(runId: string, batchId: string | undefined, error: string): Promise<void> {
    if (batchId) await this.repo.failBatch(batchId, error);
    const failed = await this.repo.transaction(async (tx) => {
      const moved = await this.repo.transition(tx, runId, ['queued', 'running'], 'failed', {
        finishedAt: new Date(),
      });
      if (moved) {
        await this.audit.append(
          {
            stream: runStream(runId),
            action: 'run.failed',
            entity: 'run',
            entityId: runId,
            payload: { batchId, error },
          },
          tx,
        );
      }
      return moved;
    });
    if (failed) await this.events.publish(runId, { type: 'run', status: 'failed' });
  }

  /**
   * Re-queues work that may have been lost between a commit and the next queue call: extracts
   * of queued or half-extracted runs, and batches nobody has touched for a while. Job ids
   * dedupe, so work that is already queued or running is not queued twice.
   */
  async sweep(): Promise<number> {
    const runs = await this.repo.runsAwaitingExtract();
    for (const runId of runs) await this.queue.extract(runId);
    const stale = await this.repo.staleBatches(this.env.PIPELINE_STALE_SECONDS);
    for (const batch of stale) await this.queue.batch(batch);
    return stale.length;
  }

  private async runStage(stage: BatchStage, batchId: string, work: StageWork): Promise<void> {
    await this.repo.heartbeat(batchId);
    const timer = this.metrics.batchDuration.startTimer({ stage });
    const rows: Record<string, number> = {};
    const tally: Tally = (status, n) => {
      if (n > 0) rows[status] = (rows[status] ?? 0) + n;
    };
    const next = await this.repo.transaction(async (tx) => {
      const batch = await this.repo.lockBatch(tx, batchId);
      if (!batch || batch.stage !== stage) return null; // already done by an earlier attempt
      const run = await this.repo.findRun(batch.runId, tx);
      if (!run || run.status !== 'running') return null; // paused or cancelled: resume re-queues
      const nextStage = await work(tx, batch, run, tally);
      if (nextStage === stage) return null; // waiting for an earlier batch
      await this.repo.setStage(tx, batch.id, nextStage);
      return { ...batch, stage: nextStage };
    });
    if (!next) return;
    timer();
    for (const [status, n] of Object.entries(rows)) {
      this.metrics.rowsProcessed.inc({ stage, status }, n);
    }
    await this.events.publish(next.runId, {
      type: 'stage',
      batchId: next.id,
      seq: next.seq,
      stage: next.stage,
    });
    if (stage === 'match') await this.wakeNextMatch(next);
    if (next.stage === 'done') await this.finalizeIfDone(next.runId);
    else await this.queue.batch(next);
  }

  /** The next batch may be waiting for this one to finish matching. */
  private async wakeNextMatch(batch: Batch): Promise<void> {
    const after = await this.repo.transaction((tx) =>
      this.repo.nextBatch(tx, batch.runId, batch.seq),
    );
    if (after?.stage === 'match') await this.queue.matchAfter(after, batch.id);
  }

  /** Read once per worker process, like compiled mappings. */
  private addressReference(): Promise<AddressReference> {
    this.reference ??= this.target.addressReference();
    return this.reference;
  }

  private async isRunning(runId: string): Promise<boolean> {
    return (await this.repo.findRun(runId))?.status === 'running';
  }

  private async mapping(id: string): Promise<CompiledMapping> {
    let compiled = this.compiled.get(id);
    if (!compiled) {
      // Mapping versions never change, so caching by id is safe. Reference data is read once
      // per worker process: restart workers after loading new reference data.
      compiled = await this.mappings.compile(await this.mappings.get(id));
      this.compiled.set(id, compiled);
    }
    return compiled;
  }
}
