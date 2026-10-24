import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Worker } from 'bullmq';
import { ProfilingService } from '../modules/profiling/profiling.service';
import { ENV } from '../shared/config/config.module';
import type { Env } from '../shared/config/env.schema';
import { bullConnection } from '../shared/queue/queue.module';
import { backoffStrategy, ProfileJob, QUEUES } from '../shared/queue/queues';

/** Consumes the profile queue in the worker process. */
@Injectable()
export class ProfileProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProfileProcessor.name);
  private worker?: Worker<ProfileJob>;

  constructor(
    private readonly profiling: ProfilingService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<ProfileJob>(
      QUEUES.profile,
      (job) => this.profiling.profileFile(job.data.sourceFileId),
      { connection: bullConnection(this.env), concurrency: 2, settings: { backoffStrategy } },
    );
    this.worker.on('failed', (job, err) =>
      this.logger.warn(
        `profile job ${job?.id} attempt ${job?.attemptsMade} failed: ${err.message}`,
      ),
    );
    this.worker.on('error', (err) => this.logger.warn(`profile worker: ${err.message}`));
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}
