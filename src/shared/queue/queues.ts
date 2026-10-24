import { Queue } from 'bullmq';

/** One BullMQ queue per kind of background work; the pipeline has one per stage. */
export const QUEUES = {
  profile: 'profile',
  extract: 'pipeline-extract',
  transform: 'pipeline-transform',
  validate: 'pipeline-validate',
  match: 'pipeline-match',
  load: 'pipeline-load',
} as const;

export type ProfileJob = { sourceFileId: string };
export type ExtractJob = { runId: string };
export type BatchJob = { runId: string; batchId: string };

/** Injection token for the producer side of the profile queue. */
export const PROFILE_QUEUE = Symbol('PROFILE_QUEUE');
export type ProfileQueue = Queue<ProfileJob>;

export type BatchStageName = 'transform' | 'validate' | 'match' | 'load';

/** Producer side of the pipeline: the extract queue plus one queue per batch stage. */
export const PIPELINE_QUEUES = Symbol('PIPELINE_QUEUES');
export type PipelineQueues = {
  extract: Queue<ExtractJob>;
} & Record<BatchStageName, Queue<BatchJob>>;

/** Job ids are derived from the work, so queuing the same work twice is a no-op (BullMQ ids may not contain ":"). */
export const extractJobId = (runId: string): string => `extract-${runId}`;
export const batchJobId = (stage: BatchStageName, batchId: string): string => `${stage}-${batchId}`;

/** Infrastructure failures (DB timeout, Redis drop) retry 3 times: 1s, 4s, 16s. */
export const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'custom' },
  removeOnComplete: 1000,
  removeOnFail: 5000,
} as const;

/**
 * Pipeline jobs are removed when they complete: a paused run's job ends without doing its
 * work, and resuming must be able to queue the same job id again.
 */
export const PIPELINE_JOB_OPTIONS = {
  ...DEFAULT_JOB_OPTIONS,
  removeOnComplete: true,
} as const;

export const backoffStrategy = (attemptsMade: number): number => 1000 * 4 ** (attemptsMade - 1);
