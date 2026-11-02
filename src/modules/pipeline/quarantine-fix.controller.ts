import { Body, Controller, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../shared/errors/zod-validation.pipe';
import { type AuthUser, CurrentUser, Roles } from '../auth';
import { QuarantineFixService } from './quarantine-fix.service';

const idParam = z.string().regex(/^\d+$/, 'must be a quarantine id');
type QuarantineId = z.infer<typeof idParam>;

const correctionSchema = z.object({
  /** Legacy column -> corrected value, as the file should have held it. */
  values: z
    .record(z.string().min(1).max(200), z.string().max(1000))
    .refine((v) => Object.keys(v).length > 0, 'correct at least one column'),
});
type CorrectionRequest = z.infer<typeof correctionSchema>;

const retrySchema = z.object({
  runId: z.uuid(),
  /** Only these quarantined rows; all corrected rows of the run when left out. */
  ids: z.array(z.string().regex(/^\d+$/)).min(1).max(1000).optional(),
});
type RetryRequest = z.infer<typeof retrySchema>;

/** Fix and retry quarantined rows. Operators only: the design's roles keep admins out of it. */
@Roles('operator')
@Controller('quarantine')
export class QuarantineFixController {
  constructor(private readonly fix: QuarantineFixService) {}

  /** Stores a correction of the row's legacy values and returns how the row now maps. */
  @Patch(':id')
  correct(
    @Param('id', new ZodValidationPipe(idParam)) id: QuarantineId,
    @Body(new ZodValidationPipe(correctionSchema)) body: CorrectionRequest,
    @CurrentUser() user: AuthUser,
  ) {
    return this.fix.correct(BigInt(id), body.values, user);
  }

  /** Runs the run's corrected rows through its mapping again; passing rows are placed. */
  @Post('retry')
  @HttpCode(200)
  retry(
    @Body(new ZodValidationPipe(retrySchema)) body: RetryRequest,
    @CurrentUser() user: AuthUser,
  ) {
    return this.fix.retry(
      body.runId,
      body.ids?.map((id) => BigInt(id)),
      user,
    );
  }
}
