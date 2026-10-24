import { Global, Inject, Injectable, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import { type ConnectionOptions, Queue } from 'bullmq';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env.schema';
import {
  DEFAULT_JOB_OPTIONS,
  PIPELINE_JOB_OPTIONS,
  PIPELINE_QUEUES,
  PipelineQueues,
  PROFILE_QUEUE,
  ProfileQueue,
  QUEUES,
} from './queues';

/**
 * Connection options (not a client instance) so each Queue/Worker owns its connection and
 * closes it on close(); BullMQ never closes an instance it was handed. BullMQ also needs
 * commands to wait for a reconnect instead of failing, hence maxRetriesPerRequest: null.
 */
export const bullConnection = (env: Env): ConnectionOptions => ({
  url: env.REDIS_URL,
  maxRetriesPerRequest: null,
});

const logger = new Logger('Queue');

function createQueue<T>(env: Env, name: string, defaultJobOptions: object): Queue<T> {
  const queue = new Queue<T>(name, { connection: bullConnection(env), defaultJobOptions });
  // Without a listener BullMQ prints raw stack traces while Redis is unreachable.
  queue.on('error', (err) => logger.warn(`${name}: ${err.message}`));
  return queue;
}

@Injectable()
class QueueShutdown implements OnApplicationShutdown {
  constructor(
    @Inject(PROFILE_QUEUE) private readonly profile: ProfileQueue,
    @Inject(PIPELINE_QUEUES) private readonly pipeline: PipelineQueues,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([this.profile, ...Object.values(this.pipeline)].map((q) => q.close()));
  }
}

/** Producer side: lets the API enqueue jobs. Workers are registered in the worker app only. */
@Global()
@Module({
  providers: [
    {
      provide: PROFILE_QUEUE,
      inject: [ENV],
      useFactory: (env: Env): ProfileQueue => createQueue(env, QUEUES.profile, DEFAULT_JOB_OPTIONS),
    },
    {
      provide: PIPELINE_QUEUES,
      inject: [ENV],
      useFactory: (env: Env): PipelineQueues => ({
        extract: createQueue(env, QUEUES.extract, PIPELINE_JOB_OPTIONS),
        transform: createQueue(env, QUEUES.transform, PIPELINE_JOB_OPTIONS),
        validate: createQueue(env, QUEUES.validate, PIPELINE_JOB_OPTIONS),
        match: createQueue(env, QUEUES.match, PIPELINE_JOB_OPTIONS),
        load: createQueue(env, QUEUES.load, PIPELINE_JOB_OPTIONS),
      }),
    },
    QueueShutdown,
  ],
  exports: [PROFILE_QUEUE, PIPELINE_QUEUES],
})
export class QueueModule {}
