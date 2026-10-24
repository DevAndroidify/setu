import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { SourcesModule } from '../sources/sources.module';
import { ProfilingController } from './profiling.controller';
import { ProfilingRepository } from './profiling.repository';
import { ProfilingService } from './profiling.service';

@Module({
  imports: [AuditModule, SourcesModule],
  controllers: [ProfilingController],
  providers: [ProfilingService, ProfilingRepository],
  exports: [ProfilingService],
})
export class ProfilingModule {}
