import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../shared/errors/zod-validation.pipe';
import { Roles } from '../auth';
import { QuarantineService } from './quarantine.service';

const listQuery = z.object({
  runId: z.uuid().optional(),
  stage: z.enum(['transform', 'validate', 'load']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().regex(/^\d+$/).optional(),
});

@Roles('operator', 'admin')
@Controller('quarantine')
export class QuarantineController {
  constructor(private readonly quarantine: QuarantineService) {}

  /** Open (unresolved) quarantined rows, oldest first. */
  @Get()
  list(@Query(new ZodValidationPipe(listQuery)) query: z.infer<typeof listQuery>) {
    const { limit, cursor, ...filter } = query;
    return this.quarantine.list(filter, limit, cursor);
  }
}
