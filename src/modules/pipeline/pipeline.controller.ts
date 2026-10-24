import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Sse } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../shared/errors/zod-validation.pipe';
import { type AuthUser, CurrentUser, Roles } from '../auth';
import { type CreateRunRequest, RunsService } from './runs.service';

const decisionSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  reason: z.string().trim().min(3, 'a reason is required').max(1000),
});
type DecisionRequest = z.infer<typeof decisionSchema>;

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

  /** Maker: ask for a production run to be approved. */
  @Roles('operator')
  @Post(':id/submit')
  @HttpCode(200)
  submit(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.runs.submit(id, user);
  }

  /** Checker: approve or reject with a reason. */
  @Roles('approver')
  @Post(':id/approve')
  @HttpCode(200)
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(decisionSchema)) body: DecisionRequest,
    @CurrentUser() user: AuthUser,
  ) {
    return this.runs.decide(id, user, body.decision, body.reason);
  }

  @Get(':id/approvals')
  approvals(@Param('id', ParseUUIDPipe) id: string) {
    return this.runs.approvalHistory(id);
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

  /** Undo a run's loads. Approvers only: rolling back changes production data. */
  @Roles('approver')
  @Post(':id/rollback')
  @HttpCode(200)
  rollback(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.runs.rollback(id, user);
  }

  /** Live progress as Server-Sent Events; the stream ends when the run does. */
  @Sse(':id/events')
  events(@Param('id', ParseUUIDPipe) id: string) {
    return this.runs.events(id);
  }

  /** Any signed-in role may follow a run's status and counts. */
  @Get(':id')
  status(@Param('id', ParseUUIDPipe) id: string) {
    return this.runs.status(id);
  }
}
