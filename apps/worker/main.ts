import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { HealthService } from '../../src/modules/health/health.service';
import { loadEnv } from '../../src/shared/config/env.schema';
import { WorkerModule } from './worker.module';

async function bootstrap(): Promise<void> {
  loadEnv(); // fail fast, before any connection is opened
  const logger = new Logger('worker');
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();

  const report = await app.get(HealthService).checkReady();
  if (report.status !== 'ok') {
    logger.error(`dependencies not ready: ${JSON.stringify(report.checks)}`);
    await app.close();
    process.exit(1);
  }
  // Queue processors (src/jobs) start with the module and keep the process alive.
  logger.log('started, dependencies ready, processing queues');
}

void bootstrap();
