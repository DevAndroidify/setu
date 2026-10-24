import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { SourcesController } from './sources.controller';
import { SourcesRepository } from './sources.repository';
import { SourcesService } from './sources.service';

@Module({
  imports: [AuditModule],
  controllers: [SourcesController],
  providers: [SourcesService, SourcesRepository],
  exports: [SourcesService],
})
export class SourcesModule {}
