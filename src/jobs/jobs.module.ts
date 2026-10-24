import { Module } from '@nestjs/common';
import { ProfilingModule } from '../modules/profiling/profiling.module';
import { ProfileProcessor } from './profile.processor';

/** Queue consumers. Imported only by the worker app, never by the API. */
@Module({
  imports: [ProfilingModule],
  providers: [ProfileProcessor],
})
export class JobsModule {}
