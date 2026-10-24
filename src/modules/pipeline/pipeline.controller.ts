import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../shared/errors/zod-validation.pipe';
import { type AuthUser, CurrentUser, Roles } from '../auth';
import { type CreateRunRequest, RunsService } from './runs.service';

const createRunSchema = z.object({
  sourceFileId: z.uuid(),
  mappingId: z.uuid(),
  mode: z.enum(['dry_run', 'production']),
});

@Controller('runs')
export class PipelineController {
  constructor(private readonly runs: RunsService) {}

  @Roles('operator', 'admin')
  @Post()
  create(
    @Body(new ZodValidationPipe(createRunSchema)) body: CreateRunRequest,
    @CurrentUser() user: AuthUser,
  ) {
    return this.runs.create(body, user);
  }

  /** 202: the run is queued; follow it with GET /runs/:id. */
  @Roles('operator', 'admin')
  @Post(':id/start')
  @HttpCode(202)
  start(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.runs.start(id, user);
  }

  @Roles('operator', 'admin')
  @Post(':id/pause')
  @HttpCode(200)
  pause(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.runs.pause(id, user);
  }

  @Roles('operator', 'admin')
  @Post(':id/resume')
  @HttpCode(202)
  resume(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.runs.resume(id, user);
  }

  @Roles('operator', 'admin')
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.runs.cancel(id, user);
  }

  /** Any signed-in role may follow a run's status and counts. */
  @Get(':id')
  status(@Param('id', ParseUUIDPipe) id: string) {
    return this.runs.status(id);
  }
}
