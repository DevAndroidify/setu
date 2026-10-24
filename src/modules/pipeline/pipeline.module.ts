import { Module } from '@nestjs/common';
import { ApprovalsModule } from '../approvals/approvals.module';
import { AuditModule } from '../audit/audit.module';
import { LineageModule } from '../lineage/lineage.module';
import { MappingsModule } from '../mappings/mappings.module';
import { QuarantineModule } from '../quarantine/quarantine.module';
import { ReconciliationModule } from '../reconciliation/reconciliation.module';
import { SourcesModule } from '../sources/sources.module';
import { TargetModule } from '../target/target.module';
import { PipelineQueueService } from './pipeline-queue.service';
import { PipelineController } from './pipeline.controller';
import { PipelineRepository } from './pipeline.repository';
import { RunsService } from './runs.service';
import { StagesService } from './stages.service';

@Module({
  imports: [
    ApprovalsModule,
    AuditModule,
    SourcesModule,
    MappingsModule,
    QuarantineModule,
    TargetModule,
    LineageModule,
    ReconciliationModule,
  ],
  controllers: [PipelineController],
  providers: [RunsService, StagesService, PipelineQueueService, PipelineRepository],
  exports: [RunsService, StagesService],
})
export class PipelineModule {}
