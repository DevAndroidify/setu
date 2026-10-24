import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Run, RunMode, RunStatus } from '@prisma/client';
import { AuditService } from '../audit';
import type { AuthUser } from '../auth';
import { MappingsService } from '../mappings';
import { SourcesService } from '../sources';
import { PipelineQueueService } from './pipeline-queue.service';
import { PipelineRepository, RunCounts } from './pipeline.repository';
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
    private readonly audit: AuditService,
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

  /** Queues the run. Starting a run that is already started changes nothing (double clicks). */
  async start(id: string, user: AuthUser): Promise<Run> {
    const started = (r: Run) => ['queued', 'running', 'completed'].includes(r.status);
    const run = await this.get(id);
    if (started(run)) return run;
    try {
      await this.move(run, ['draft'], 'queued', user, 'run.started');
    } catch (err) {
      // A concurrent start won the race: that is the double click this endpoint absorbs.
      const now = await this.get(id);
      if (err instanceof ConflictException && started(now)) return now;
      throw err;
    }
    await this.queue.extract(id);
    return this.get(id);
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
      ['draft', 'queued', 'running', 'paused'],
      'cancelled',
      user,
      'run.cancelled',
    );
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

  private async move(run: Run, from: RunStatus[], to: RunStatus, user: AuthUser, action: string) {
    await this.repo.transaction(async (tx) => {
      const moved = await this.repo.transition(
        tx,
        run.id,
        from,
        to,
        to === 'cancelled' ? { finishedAt: new Date() } : {},
      );
      if (!moved) {
        throw new ConflictException(`A ${run.status} run cannot be moved to ${to}`);
      }
      await this.audit.append(
        { stream: runStream(run.id), actorId: user.id, action, entity: 'run', entityId: run.id },
        tx,
      );
    });
  }
}
