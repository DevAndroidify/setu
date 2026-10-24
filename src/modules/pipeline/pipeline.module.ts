import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { LineageModule } from '../lineage/lineage.module';
import { MappingsModule } from '../mappings/mappings.module';
import { QuarantineModule } from '../quarantine/quarantine.module';
import { SourcesModule } from '../sources/sources.module';
import { TargetModule } from '../target/target.module';
import { PipelineQueueService } from './pipeline-queue.service';
import { PipelineController } from './pipeline.controller';
import { PipelineRepository } from './pipeline.repository';
import { RunsService } from './runs.service';
import { StagesService } from './stages.service';

@Module({
  imports: [
    AuditModule,
    SourcesModule,
    MappingsModule,
    QuarantineModule,
    TargetModule,
    LineageModule,
  ],
  controllers: [PipelineController],
  providers: [RunsService, StagesService, PipelineQueueService, PipelineRepository],
  exports: [RunsService, StagesService],
})
export class PipelineModule {}
