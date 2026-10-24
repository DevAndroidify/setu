import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  S3_ENDPOINT: z.string().url(),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(3).default('setu-sources'),
  JWT_SECRET: z.string().min(32, 'must be at least 32 characters'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).default(7),
  // Pipeline tuning: measure with the load test before changing (docs/ARCHITECTURE.md).
  PIPELINE_BATCH_SIZE: z.coerce.number().int().min(1).max(10_000).default(1000),
  PIPELINE_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(4),
  /** How long a worker holds a job before BullMQ treats it as stalled (crashed worker). */
  PIPELINE_LOCK_MS: z.coerce.number().int().min(1000).default(30_000),
  /** A batch whose stage has not been picked up for this long is queued again. */
  PIPELINE_STALE_SECONDS: z.coerce.number().int().min(1).default(60),
  PIPELINE_SWEEP_MS: z.coerce.number().int().min(500).default(15_000),
});

export type Env = z.infer<typeof envSchema>;

/** Parses and validates environment variables. Error text names the keys, never the values. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return result.data;
}
