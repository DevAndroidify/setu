import { Module } from '@nestjs/common';
import { JobsModule } from '../../src/jobs/jobs.module';
import { HealthModule } from '../../src/modules/health/health.module';
import { ConfigModule } from '../../src/shared/config/config.module';
import { DbModule } from '../../src/shared/db/db.module';
import { QueueModule } from '../../src/shared/queue/queue.module';
import { RedisModule } from '../../src/shared/queue/redis.module';
import { StorageModule } from '../../src/shared/storage/storage.module';

@Module({
  imports: [
    ConfigModule,
    DbModule,
    RedisModule,
    QueueModule,
    StorageModule,
    HealthModule,
    JobsModule,
  ],
})
export class WorkerModule {}
