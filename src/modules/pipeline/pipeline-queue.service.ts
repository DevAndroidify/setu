import { Inject, Injectable } from '@nestjs/common';
import type { Batch } from '@prisma/client';
import {
  batchJobId,
  extractJobId,
  PIPELINE_QUEUES,
  type PipelineQueues,
} from '../../shared/queue/queues';

/**
 * Queues pipeline work. Job ids come from the work itself (stage + batch), so queuing the same
 * work twice, from a retry, the sweeper or a resume, never runs it twice.
 */
@Injectable()
export class PipelineQueueService {
  constructor(@Inject(PIPELINE_QUEUES) private readonly queues: PipelineQueues) {}

  async extract(runId: string): Promise<void> {
    await this.queues.extract.add('extract', { runId }, { jobId: extractJobId(runId) });
  }

  /** Queues the batch's next stage; batches waiting to be extracted or done are skipped. */
  async batch(batch: Pick<Batch, 'id' | 'runId' | 'stage'>): Promise<void> {
    if (batch.stage === 'extract' || batch.stage === 'done') return;
    await this.queues[batch.stage].add(
      batch.stage,
      { runId: batch.runId, batchId: batch.id },
      { jobId: batchJobId(batch.stage, batch.id) },
    );
  }
}
