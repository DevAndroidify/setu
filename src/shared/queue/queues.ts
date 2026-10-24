import { Queue } from 'bullmq';

/** One BullMQ queue per kind of background work. */
export const QUEUES = {
  profile: 'profile',
} as const;

export type ProfileJob = { sourceFileId: string };

/** Injection token for the producer side of the profile queue. */
export const PROFILE_QUEUE = Symbol('PROFILE_QUEUE');
export type ProfileQueue = Queue<ProfileJob>;

/** Infrastructure failures (DB timeout, Redis drop) retry 3 times: 1s, 4s, 16s. */
export const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'custom' },
  removeOnComplete: 1000,
  removeOnFail: 5000,
} as const;

export const backoffStrategy = (attemptsMade: number): number => 1000 * 4 ** (attemptsMade - 1);
