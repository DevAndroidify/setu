import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { Roles } from '../auth';
import { ProfilingService } from './profiling.service';

@Roles('operator', 'admin')
@Controller('files')
export class ProfilingController {
  constructor(private readonly profiling: ProfilingService) {}

  /** 404 until the worker has profiled the file. */
  @Get(':id/profile')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.profiling.getProfile(id);
  }
}
