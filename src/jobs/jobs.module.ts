import { Module } from '@nestjs/common';
import { PipelineModule } from '../modules/pipeline/pipeline.module';
import { ProfilingModule } from '../modules/profiling/profiling.module';
import { PipelineProcessor } from './pipeline.processor';
import { ProfileProcessor } from './profile.processor';

/** Queue consumers. Imported only by the worker app, never by the API. */
@Module({
  imports: [ProfilingModule, PipelineModule],
  providers: [ProfileProcessor, PipelineProcessor],
})
export class JobsModule {}
