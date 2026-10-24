import { Global, Inject, Injectable, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import { type ConnectionOptions, Queue } from 'bullmq';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env.schema';
import { DEFAULT_JOB_OPTIONS, PROFILE_QUEUE, ProfileQueue, QUEUES } from './queues';

/**
 * Connection options (not a client instance) so each Queue/Worker owns its connection and
 * closes it on close(); BullMQ never closes an instance it was handed. BullMQ also needs
 * commands to wait for a reconnect instead of failing, hence maxRetriesPerRequest: null.
 */
export const bullConnection = (env: Env): ConnectionOptions => ({
  url: env.REDIS_URL,
  maxRetriesPerRequest: null,
});

@Injectable()
class QueueShutdown implements OnApplicationShutdown {
  constructor(@Inject(PROFILE_QUEUE) private readonly profile: ProfileQueue) {}
  async onApplicationShutdown(): Promise<void> {
    await this.profile.close();
  }
}

/** Producer side: lets the API enqueue jobs. Workers are registered in the worker app only. */
@Global()
@Module({
  providers: [
    {
      provide: PROFILE_QUEUE,
      inject: [ENV],
      useFactory: (env: Env): ProfileQueue => {
        const queue: ProfileQueue = new Queue(QUEUES.profile, {
          connection: bullConnection(env),
          defaultJobOptions: DEFAULT_JOB_OPTIONS,
        });
        // Without a listener BullMQ prints raw stack traces while Redis is unreachable.
        const logger = new Logger('Queue');
        queue.on('error', (err) => logger.warn(`${QUEUES.profile}: ${err.message}`));
        return queue;
      },
    },
    QueueShutdown,
  ],
  exports: [PROFILE_QUEUE],
})
export class QueueModule {}
