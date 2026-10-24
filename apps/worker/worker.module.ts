import { Module } from '@nestjs/common';
import { JobsModule } from '../../src/jobs/jobs.module';
import { HealthModule } from '../../src/modules/health/health.module';
import { ConfigModule } from '../../src/shared/config/config.module';
import { DbModule } from '../../src/shared/db/db.module';
import { LoggingModule } from '../../src/shared/logging/logging.module';
import { MetricsModule } from '../../src/shared/metrics/metrics';
import { QueueModule } from '../../src/shared/queue/queue.module';
import { RedisModule } from '../../src/shared/queue/redis.module';
import { StorageModule } from '../../src/shared/storage/storage.module';

@Module({
  imports: [
    ConfigModule,
    LoggingModule,
    MetricsModule,
    DbModule,
    RedisModule,
    QueueModule,
    StorageModule,
    HealthModule,
    JobsModule,
  ],
})
export class WorkerModule {}
