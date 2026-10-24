import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Prisma, Run, RunMode, RunStatus } from '@prisma/client';
import {
  concat,
  concatMap,
  distinctUntilChanged,
  interval,
  map,
  merge,
  Observable,
  of,
  takeWhile,
} from 'rxjs';
import { ApprovalsService } from '../approvals/approvals.service';
import { AuditService } from '../audit';
import type { AuthUser } from '../auth';
import { LineageService } from '../lineage/lineage.service';
import { MappingsService } from '../mappings';
import { SourcesService } from '../sources';
import { TargetService } from '../target/target.service';
import { PipelineQueueService } from './pipeline-queue.service';
import { PipelineRepository, RunCounts } from './pipeline.repository';
import { RunEventsService } from './run-events.service';
import { runStream } from './stages.service';

export type CreateRunRequest = { sourceFileId: string; mappingId: string; mode: RunMode };

/** API side of the pipeline: creates runs and moves them through their lifecycle. */
@Injectable()
export class RunsService {
  constructor(
    private readonly repo: PipelineRepository,
    private readonly queue: PipelineQueueService,
    private readonly sources: SourcesService,
    private readonly mappings: MappingsService,
    private readonly target: TargetService,
    private readonly lineage: LineageService,
    private readonly approvals: ApprovalsService,
    private readonly audit: AuditService,
    private readonly runEvents: RunEventsService,
  ) {}

  async create(input: CreateRunRequest, user: AuthUser): Promise<Run> {
    const file = await this.sources.getFile(input.sourceFileId);
    const mapping = await this.mappings.get(input.mappingId);
    if (file.sourceId !== mapping.sourceId) {
      throw new UnprocessableEntityException(
        'The file and the mapping belong to different sources',
      );
    }
    return this.repo.transaction(async (tx) => {
      const run = await this.repo.createRun(tx, { ...input, createdBy: user.id });
      await this.audit.append(
        {
          stream: runStream(run.id),
          actorId: user.id,
          action: 'run.created',
          entity: 'run',
          entityId: run.id,
          payload: { ...input, mappingVersion: mapping.version, sha256: file.sha256 },
        },
        tx,
      );
      return run;
    });
  }

  /**
   * Queues the run. A production run must have a current approval from someone other than its
   * maker. Starting a run that is already started changes nothing (double clicks).
   */
  async start(id: string, user: AuthUser): Promise<Run> {
    const started = (r: Run) => ['queued', 'running', 'completed'].includes(r.status);
    const run = await this.get(id);
    if (started(run)) return run;
    if (run.mode === 'production') await this.requireApproval(run, user);
    try {
      await this.move(
        run,
        [run.mode === 'production' ? 'approved' : 'draft'],
        'queued',
        user,
        'run.started',
      );
    } catch (err) {
      // A concurrent start won the race: that is the double click this endpoint absorbs.
      const now = await this.get(id);
      if (err instanceof ConflictException && started(now)) return now;
      throw err;
    }
    await this.queue.extract(id);
    return this.get(id);
  }

  private async requireApproval(run: Run, user: AuthUser): Promise<void> {
    if (run.status === 'draft' || run.status === 'awaiting_approval') {
      throw new ConflictException(
        'A production run needs approval before it can start: submit it first',
      );
    }
    const approval = await this.approvals.usableApproval(run.id);
    if (approval === 'expired') {
      await this.move(run, ['approved'], 'draft', user, 'run.approval_expired', {
        approvedBy: null,
      });
      throw new ConflictException('The approval expired after 24 hours: submit the run again');
    }
    if (approval === 'missing') throw new ConflictException('The run has no approval');
  }

  /** Maker: asks for a production run to be approved. */
  async submit(id: string, user: AuthUser): Promise<Run> {
    const run = await this.get(id);
    if (run.mode !== 'production') throw new ConflictException('Dry runs do not need approval');
    await this.repo.transaction(async (tx) => {
      if (!(await this.repo.transition(tx, id, ['draft'], 'awaiting_approval'))) {
        throw new ConflictException(`A ${run.status} run cannot be submitted`);
      }
      const request = await this.approvals.request(tx, id, user.id);
      await this.audit.append(
        {
          stream: runStream(id),
          actorId: user.id,
          action: 'run.submitted',
          entity: 'run',
          entityId: id,
          payload: { approvalId: request.id, expiresAt: request.expiresAt },
        },
        tx,
      );
    });
    return this.get(id);
  }

  /**
   * Checker: approves or rejects with a reason. Whoever created or submitted the run may not
   * decide it (and the database refuses it too). A request older than 24 hours has expired.
   */
  async decide(
    id: string,
    user: AuthUser,
    decision: 'approved' | 'rejected',
    reason: string,
  ): Promise<Run> {
    const run = await this.get(id);
    const expired = await this.repo.transaction(async (tx) => {
      const pending = await this.approvals.pendingFor(id, user.id, [run.createdBy], tx);
      if (pending === 'expired') {
        await this.repo.transition(tx, id, ['awaiting_approval'], 'draft');
        await this.audit.append(
          {
            stream: runStream(id),
            actorId: user.id,
            action: 'run.approval_expired',
            entity: 'run',
            entityId: id,
          },
          tx,
        );
        return true;
      }
      await this.approvals.decide(tx, pending, user.id, decision, reason);
      const to = decision === 'approved' ? 'approved' : 'draft';
      const extra = decision === 'approved' ? { approvedBy: user.id } : {};
      if (!(await this.repo.transition(tx, id, ['awaiting_approval'], to, extra))) {
        throw new ConflictException(`A ${run.status} run cannot be ${decision}`);
      }
      await this.audit.append(
        {
          stream: runStream(id),
          actorId: user.id,
          action: decision === 'approved' ? 'run.approved' : 'run.rejected',
          entity: 'run',
          entityId: id,
          payload: { approvalId: pending.id },
          reason,
        },
        tx,
      );
      return false;
    });
    // Outside the transaction, so the expiry above is committed rather than rolled back.
    if (expired)
      throw new ConflictException(
        'The approval request expired after 24 hours: submit the run again',
      );
    return this.get(id);
  }

  approvalHistory(id: string) {
    return this.approvals.history(id);
  }

  async pause(id: string, user: AuthUser): Promise<Run> {
    await this.move(await this.get(id), ['queued', 'running'], 'paused', user, 'run.paused');
    return this.get(id);
  }

  /** Continues where the run stopped: the extract if unfinished, then every unfinished batch. */
  async resume(id: string, user: AuthUser): Promise<Run> {
    const run = await this.get(id);
    await this.move(run, ['paused'], 'running', user, 'run.resumed');
    if ((run.counts as RunCounts).total === undefined) await this.queue.extract(id);
    for (const batch of await this.repo.unfinishedBatches(id)) await this.queue.batch(batch);
    return this.get(id);
  }

  /** Stops the run for good. Rows already loaded stay until the run is rolled back. */
  async cancel(id: string, user: AuthUser): Promise<Run> {
    await this.move(
      await this.get(id),
      ['draft', 'awaiting_approval', 'approved', 'queued', 'running', 'paused'],
      'cancelled',
      user,
      'run.cancelled',
    );
    return this.get(id);
  }

  /**
   * Undoes a production run's loads, newest batch first, one transaction per batch: deletes the
   * persons and their lineage and marks the staged rows valid again; then the run's households. Refused when a later run
   * has linked to those persons. Safe to repeat after a crash: emptied batches are skipped.
   */
  async rollback(id: string, user: AuthUser): Promise<Run> {
    const run = await this.get(id);
    if (run.mode !== 'production') throw new ConflictException('Only production runs load data');
    if (!['completed', 'cancelled', 'failed'].includes(run.status)) {
      throw new ConflictException(`A ${run.status} run cannot be rolled back`);
    }
    if (await this.lineage.linkedFromOtherRuns(id, await this.target.personIdsCreatedByRun(id))) {
      throw new ConflictException(
        'Later runs have linked to records from this run; roll those back first',
      );
    }

    let removed = 0;
    for (const batch of await this.repo.batchesNewestFirst(id)) {
      await this.repo.transaction(async (tx) => {
        const personIds = await this.lineage.deleteForBatch(tx, batch.id);
        if (personIds.length === 0) return;
        const deleted = await this.target.deletePersons(tx, personIds, id);
        await this.repo.unloadBatch(tx, batch.id);
        await this.audit.append(
          {
            stream: runStream(id),
            actorId: user.id,
            action: 'batch.rolled_back',
            entity: 'batch',
            entityId: batch.id,
            payload: { seq: batch.seq, removed: deleted },
          },
          tx,
        );
        removed += deleted;
      });
    }

    await this.repo.transaction(async (tx) => {
      const households = await this.target.deleteHouseholdsForRun(tx, id);
      await this.repo.transition(tx, id, ['completed', 'cancelled', 'failed'], 'rolled_back');
      await this.audit.append(
        {
          stream: runStream(id),
          actorId: user.id,
          action: 'run.rolled_back',
          entity: 'run',
          entityId: id,
          payload: { removed, households },
        },
        tx,
      );
    });
    await this.runEvents.publish(id, { type: 'run', status: 'rolled_back' });
    return this.get(id);
  }

  async get(id: string): Promise<Run> {
    const run = await this.repo.findRun(id);
    if (!run) throw new NotFoundException('Run not found');
    return run;
  }

  /** The run with live progress: counts from staging and batches per stage. */
  async status(id: string) {
    const run = await this.get(id);
    const [staged, batches] = await Promise.all([
      this.repo.stagedCounts(id),
      this.repo.batchSummary(id),
    ]);
    return {
      ...run,
      progress: {
        ...staged,
        batches: Object.fromEntries(batches.map((b) => [b.stage, b._count])),
      },
    };
  }

  /**
   * Live progress for Server-Sent Events: the run's status now, then again whenever the worker
   * reports progress (and every 5 seconds in case an event was lost), until the run ends.
   */
  async events(id: string): Promise<Observable<{ data: unknown }>> {
    await this.get(id); // 404 before the stream starts
    const ended = (status: string) =>
      ['completed', 'failed', 'cancelled', 'rolled_back'].includes(status);
    // Subscribed to the events before the first read, so nothing between the two is missed.
    const triggers = merge(this.runEvents.stream(id), interval(5000));
    return concat(of(null), triggers).pipe(
      concatMap(() => this.status(id)),
      distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
      takeWhile((s) => !ended(s.status), true),
      map((s) => ({ data: s })),
    );
  }

  private async move(
    run: Run,
    from: RunStatus[],
    to: RunStatus,
    user: AuthUser,
    action: string,
    extra: Prisma.RunUncheckedUpdateManyInput = {},
  ) {
    await this.repo.transaction(async (tx) => {
      const moved = await this.repo.transition(tx, run.id, from, to, {
        ...(to === 'cancelled' ? { finishedAt: new Date() } : {}),
        ...extra,
      });
      if (!moved) {
        throw new ConflictException(`A ${run.status} run cannot be moved to ${to}`);
      }
      await this.audit.append(
        { stream: runStream(run.id), actorId: user.id, action, entity: 'run', entityId: run.id },
        tx,
      );
    });
    await this.runEvents.publish(run.id, { type: 'run', status: to });
  }
}
