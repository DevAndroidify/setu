import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { loadEnv } from '../../src/shared/config/env.schema';
import { ApiModule } from './api.module';

async function bootstrap(): Promise<void> {
  const env = loadEnv(); // fail fast, before any connection is opened
  const app = await NestFactory.create(ApiModule);
  app.setGlobalPrefix('api/v1', { exclude: ['health/live', 'health/ready'] });
  app.enableShutdownHooks();
  await app.listen(env.API_PORT);
  new Logger('api').log(`listening on port ${env.API_PORT}`);
}

void bootstrap();
