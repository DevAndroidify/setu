import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { SourcesModule } from '../sources/sources.module';
import { TargetModule } from '../target/target.module';
import { MappingsController } from './mappings.controller';
import { MappingsRepository } from './mappings.repository';
import { MappingsService } from './mappings.service';

@Module({
  imports: [AuditModule, SourcesModule, TargetModule],
  controllers: [MappingsController],
  providers: [MappingsService, MappingsRepository],
  exports: [MappingsService],
})
export class MappingsModule {}
