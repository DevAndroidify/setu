import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import { StagesService } from '../modules/pipeline/stages.service';
import { ENV } from '../shared/config/config.module';
import type { Env } from '../shared/config/env.schema';
import { bullConnection } from '../shared/queue/queue.module';
import {
  backoffStrategy,
  BatchJob,
  DEFAULT_JOB_OPTIONS,
  ExtractJob,
  QUEUES,
} from '../shared/queue/queues';

/**
 * Runs the pipeline stages in the worker process: one BullMQ worker per stage queue, plus a
 * sweeper that re-queues batches lost between a stage's commit and the next stage's queueing.
 * A crashed worker's jobs are returned to their queue by BullMQ once their lock expires.
 */
@Injectable()
export class PipelineProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PipelineProcessor.name);
  private readonly workers: Worker[] = [];
  private sweeper?: NodeJS.Timeout;

  constructor(
    private readonly stages: StagesService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit(): void {
    this.start<ExtractJob>(QUEUES.extract, (job) => this.stages.extract(job.data.runId), 1);
    this.start<BatchJob>(QUEUES.transform, (job) => this.stages.transform(job.data.batchId));
    this.start<BatchJob>(QUEUES.validate, (job) => this.stages.validate(job.data.batchId));
    this.start<BatchJob>(QUEUES.load, (job) => this.stages.load(job.data.batchId));

    this.sweeper = setInterval(() => {
      this.stages
        .sweep()
        .then((n) => n && this.logger.log(`re-queued ${n} stale batches`))
        .catch((err: Error) => this.logger.warn(`sweep failed: ${err.message}`));
    }, this.env.PIPELINE_SWEEP_MS);
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.sweeper);
    await Promise.all(this.workers.map((w) => w.close()));
  }

  private start<T extends ExtractJob | BatchJob>(
    queue: string,
    process: (job: Job<T>) => Promise<void>,
    concurrency = this.env.PIPELINE_CONCURRENCY,
  ): void {
    const worker = new Worker<T>(queue, process, {
      connection: bullConnection(this.env),
      concurrency,
      lockDuration: this.env.PIPELINE_LOCK_MS,
      stalledInterval: Math.max(1000, Math.floor(this.env.PIPELINE_LOCK_MS / 2)),
      settings: { backoffStrategy },
    });
    worker.on('failed', (job, err) => {
      if (!job) return;
      this.logger.warn(`${queue} job ${job.id} attempt ${job.attemptsMade} failed: ${err.message}`);
      if (job.attemptsMade >= (job.opts.attempts ?? DEFAULT_JOB_OPTIONS.attempts)) {
        const batchId = 'batchId' in job.data ? job.data.batchId : undefined;
        void this.stages.fail(job.data.runId, batchId, err.message);
      }
    });
    worker.on('error', (err) => this.logger.warn(`${queue} worker: ${err.message}`));
    this.workers.push(worker);
  }
}
