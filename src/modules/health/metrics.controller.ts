import { Controller, Get, Header, Inject } from '@nestjs/common';
import { Metrics } from '../../shared/metrics/metrics';
import {
  PIPELINE_QUEUES,
  type PipelineQueues,
  PROFILE_QUEUE,
  type ProfileQueue,
} from '../../shared/queue/queues';
import { Public } from '../auth/decorators';

/** Prometheus scrape endpoint of the API process. Like /health, meant for the internal network. */
@Public()
@Controller('metrics')
export class MetricsController {
  constructor(
    private readonly metrics: Metrics,
    @Inject(PIPELINE_QUEUES) private readonly pipeline: PipelineQueues,
    @Inject(PROFILE_QUEUE) private readonly profile: ProfileQueue,
  ) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async scrape(): Promise<string> {
    // Queue depth is read when scraped, so it is current whichever worker did the work.
    await Promise.all(
      [this.profile, ...Object.values(this.pipeline)].map(async (queue) =>
        this.metrics.queueWaiting.set({ queue: queue.name }, await queue.getWaitingCount()),
      ),
    );
    return this.metrics.registry.metrics();
  }
}
