import { Module } from '@nestjs/common';
import { AuditModule } from '../../src/modules/audit/audit.module';
import { AuthModule } from '../../src/modules/auth/auth.module';
import { HealthModule } from '../../src/modules/health/health.module';
import { MappingsModule } from '../../src/modules/mappings/mappings.module';
import { PipelineModule } from '../../src/modules/pipeline/pipeline.module';
import { QuarantineModule } from '../../src/modules/quarantine/quarantine.module';
import { ReconciliationModule } from '../../src/modules/reconciliation/reconciliation.module';
import { ProfilingModule } from '../../src/modules/profiling/profiling.module';
import { SourcesModule } from '../../src/modules/sources/sources.module';
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
    AuthModule,
    AuditModule,
    HealthModule,
    SourcesModule,
    ProfilingModule,
    MappingsModule,
    PipelineModule,
    QuarantineModule,
    ReconciliationModule,
  ],
})
export class ApiModule {}
