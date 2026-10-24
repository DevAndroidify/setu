import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../shared/errors/zod-validation.pipe';
import { type AuthUser, CurrentUser, Roles } from '../auth';
import { MatchReviewService } from './match-review.service';

const listQuery = z.object({
  runId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().regex(/^\d+$/).optional(),
});

const idParam = z.string().regex(/^\d+$/, 'must be a match id');
type MatchId = z.infer<typeof idParam>;

const decisionSchema = z.object({
  decision: z.enum(['link', 'not_same']),
  reason: z.string().trim().min(3, 'a reason is required').max(1000),
});
type DecisionRequest = z.infer<typeof decisionSchema>;

/** Duplicate candidates awaiting a reviewer. */
@Roles('reviewer')
@Controller('matches')
export class MatchesController {
  constructor(private readonly review: MatchReviewService) {}

  @Get()
  list(@Query(new ZodValidationPipe(listQuery)) query: z.infer<typeof listQuery>) {
    const { limit, cursor, ...filter } = query;
    return this.review.pending(filter, limit, cursor);
  }

  /** Link the held row to the person it matches, or load it as a different person. */
  @Post(':id/decision')
  @HttpCode(200)
  decide(
    @Param('id', new ZodValidationPipe(idParam)) id: MatchId,
    @Body(new ZodValidationPipe(decisionSchema)) body: DecisionRequest,
    @CurrentUser() user: AuthUser,
  ) {
    return this.review.decide(BigInt(id), body, user);
  }
}
