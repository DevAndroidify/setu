import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Run } from '@prisma/client';
import { AuditService } from '../audit';
import type { AuthUser } from '../auth';
import { CompiledMapping, mapRow, MappingsService } from '../mappings';
import { QuarantineService } from '../quarantine/quarantine.service';
import { todayInNepal } from '../validation';
import { PipelineQueueService } from './pipeline-queue.service';
import { PipelineRepository } from './pipeline.repository';
import { RunEventsService } from './run-events.service';
import { runStream, StagesService } from './stages.service';

type Corrections = Record<string, string>;

/**
 * Fixing quarantined rows. An operator corrects a row's legacy values (stored beside the raw
 * row, which never changes); retry runs corrected rows through the run's pinned mapping again.
 * Rows that pass reopen the run: in production they go through matching and loading like any
 * other row, under the run's approval, and the run completes again with a new reconciliation.
 */
@Injectable()
export class QuarantineFixService {
  constructor(
    private readonly repo: PipelineRepository,
    private readonly quarantine: QuarantineService,
    private readonly mappings: MappingsService,
    private readonly stages: StagesService,
    private readonly queue: PipelineQueueService,
    private readonly audit: AuditService,
    private readonly runEvents: RunEventsService,
  ) {}

  /** Stores a correction and answers how the row maps with it. Changes no row status. */
  async correct(id: bigint, values: Corrections, user: AuthUser) {
    return this.repo.transaction(async (tx) => {
      const entry = await this.quarantine.find(id, tx);
      if (!entry) throw new NotFoundException('Quarantined row not found');
      if (entry.resolvedAt)
        throw new ConflictException('This row has already been fixed and retried');
      const raw = entry.stagedRow.rawRow.raw as Corrections;
      const unknown = Object.keys(values).filter((column) => !(column in raw));
      if (unknown.length) {
        throw new BadRequestException(`The file has no column ${unknown.join(', ')}`);
      }
      const run = (await this.repo.findRun(entry.stagedRow.rawRow.runId, tx))!;
      this.assertFixable(run);

      // Only what differs from the legacy file is kept as the correction.
      const merged = { ...((entry.corrected as Corrections | null) ?? {}), ...values };
      const corrected = Object.fromEntries(
        Object.entries(merged).filter(([column, value]) => raw[column] !== value),
      );
      await this.quarantine.setCorrection(tx, id, corrected, user.id);
      await this.audit.append(
        {
          stream: runStream(run.id),
          actorId: user.id,
          action: 'quarantine.corrected',
          entity: 'quarantine',
          entityId: id.toString(),
          // Column names only: the values are personal data.
          payload: { rowNo: entry.stagedRow.rawRow.rowNo, columns: Object.keys(values) },
        },
        tx,
      );
      const result = mapRow({ ...raw, ...corrected }, await this.compile(run), {
        today: todayInNepal(),
      });
      return { id: id.toString(), rowNo: entry.stagedRow.rawRow.rowNo, corrected, result };
    });
  }

  /**
   * Retries the run's corrected rows (or only `ids`). Rows that pass are staged as valid and
   * their quarantine entries closed; rows that still fail keep their entry with the new
   * reasons. If any passed, the run is reopened to place them.
   */
  async retry(runId: string, ids: bigint[] | undefined, user: AuthUser) {
    const run = await this.repo.findRun(runId);
    if (!run) throw new NotFoundException('Run not found');
    this.assertFixable(run);
    const mapping = await this.compile(run);
    const ctx = { today: todayInNepal() };

    const outcome = await this.repo.transaction(async (tx) => {
      const entries = await this.quarantine.correctedForRun(tx, runId, ids);
      const results = entries.map((entry) => ({
        entry,
        result: mapRow(
          { ...(entry.stagedRow.rawRow.raw as Corrections), ...(entry.corrected as Corrections) },
          mapping,
          ctx,
        ),
      }));
      const passed = results.filter((r) => r.result.status === 'valid');
      const failed = results.filter((r) => r.result.status !== 'valid');

      for (const { entry, result } of failed) {
        await this.quarantine.setReasons(tx, entry.id, result.errors);
      }
      for (const { entry, result } of passed) {
        await this.repo.restage(tx, entry.stagedRowId, result.values, result.warnings, 'valid');
      }
      await this.quarantine.resolve(
        tx,
        passed.map((p) => p.entry.id),
        user.id,
      );

      const batchIds = [...new Set(passed.map((p) => p.entry.stagedRow.rawRow.batchId))];
      if (passed.length > 0) {
        if (!(await this.repo.transition(tx, runId, ['completed'], 'running'))) {
          throw new ConflictException('The run changed while retrying; try again');
        }
        // Production rows still have to be matched and loaded; dry runs only recount.
        if (run.mode === 'production') await this.repo.reopenBatches(tx, batchIds, 'match');
      }
      await this.audit.append(
        {
          stream: runStream(runId),
          actorId: user.id,
          action: 'quarantine.retried',
          entity: 'run',
          entityId: runId,
          payload: { retried: results.length, passed: passed.length, stillFailing: failed.length },
        },
        tx,
      );
      return {
        retried: results.length,
        passed: passed.length,
        stillFailing: failed.length,
        reopened: passed.length > 0,
        batchIds,
      };
    });

    if (outcome.reopened) {
      await this.runEvents.publish(runId, { type: 'run', status: 'running' });
      if (run.mode === 'production') {
        for (const id of outcome.batchIds) await this.queue.batch({ id, runId, stage: 'match' });
      } else {
        await this.stages.finalizeIfDone(runId);
      }
    }
    const { batchIds: _batchIds, ...summary } = outcome;
    return summary;
  }

  /** Rows can be fixed once the run has finished and while its result stands. */
  private assertFixable(run: Run): void {
    if (run.status !== 'completed') {
      throw new ConflictException(
        `Rows of a ${run.status} run cannot be fixed: fix and retry rows once the run has completed`,
      );
    }
  }

  private async compile(run: Run): Promise<CompiledMapping> {
    return this.mappings.compile(await this.mappings.get(run.mappingId));
  }
}
