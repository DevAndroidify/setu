import { Controller, Get, Param, ParseUUIDPipe, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { ZodValidationPipe } from '../../shared/errors/zod-validation.pipe';
import { Roles } from '../auth';
import { ReconciliationService } from './reconciliation.service';

const formatQuery = z.object({ format: z.enum(['json', 'csv']).default('json') });

@Roles('auditor')
@Controller('runs')
export class ReconciliationController {
  constructor(private readonly reconciliation: ReconciliationService) {}

  /** The run's report as JSON, or as CSV with ?format=csv. */
  @Get(':id/reconciliation')
  async get(
    @Param('id', ParseUUIDPipe) runId: string,
    @Query(new ZodValidationPipe(formatQuery)) query: z.infer<typeof formatQuery>,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (query.format === 'json') return this.reconciliation.get(runId);
    const csv = await this.reconciliation.csv(runId);
    res
      .type('text/csv')
      .setHeader('Content-Disposition', `attachment; filename="reconciliation-${runId}.csv"`);
    return csv;
  }
}
