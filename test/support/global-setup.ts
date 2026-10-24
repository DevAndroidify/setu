import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { loadReferenceData } from '../../prisma/reference/load-reference';

// Same images as docker-compose.yml, so tests run against what developers run locally.
const MINIO_IMAGE = 'pgsty/minio:RELEASE.2026-08-04T00-00-00Z';
const S3_ACCESS_KEY = 'test_access_key';
const S3_SECRET_KEY = 'test_secret_key';

declare global {
  var __containers: StartedTestContainer[] | undefined;
}

/**
 * Starts throwaway Postgres, Redis and MinIO containers, applies the migrations, loads the
 * address reference data and exports
 * the connection settings as environment variables for the test files.
 */
export default async function globalSetup(): Promise<void> {
  const [postgres, redis, minio] = await Promise.all([
    new PostgreSqlContainer('postgres:16').withDatabase('setu').start(),
    new RedisContainer('redis:7').start(),
    new GenericContainer(MINIO_IMAGE)
      .withCommand(['server', '/data'])
      .withEnvironment({ MINIO_ROOT_USER: S3_ACCESS_KEY, MINIO_ROOT_PASSWORD: S3_SECRET_KEY })
      .withExposedPorts(9000)
      .withWaitStrategy(Wait.forHttp('/minio/health/ready', 9000))
      .start(),
  ]);
  globalThis.__containers = [postgres, redis, minio];

  Object.assign(process.env, {
    NODE_ENV: 'test',
    LOG_LEVEL: 'warn',
    DATABASE_URL: postgres.getConnectionUri(),
    REDIS_URL: `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`,
    S3_ENDPOINT: `http://${minio.getHost()}:${minio.getMappedPort(9000)}`,
    S3_ACCESS_KEY,
    S3_SECRET_KEY,
    JWT_SECRET: 'test_only_jwt_secret_0123456789abcdef',
    // Small batches give every test run several batches; quick sweeps keep recovery fast.
    PIPELINE_BATCH_SIZE: '200',
    PIPELINE_SWEEP_MS: '1000',
    PIPELINE_STALE_SECONDS: '5',
  });

  execFileSync(join(__dirname, '../../node_modules/.bin/prisma'), ['migrate', 'deploy'], {
    env: process.env,
    stdio: 'pipe',
  });
  const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
  try {
    await loadReferenceData(prisma);
  } finally {
    await prisma.$disconnect();
  }
}
