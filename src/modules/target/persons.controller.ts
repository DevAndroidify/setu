import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../shared/errors/zod-validation.pipe';
import { type AuthUser, CurrentUser } from '../auth';
import { PersonsService } from './persons.service';

const calendar = z.enum(['ad', 'bs']).default('ad');

const listQuery = z.object({
  q: z.string().trim().min(2).max(100).optional(),
  localUnit: z.string().min(1).max(100).optional(),
  calendar,
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.guid().optional(), // person ids are hash-derived, not versioned UUIDs
});
type ListQuery = z.infer<typeof listQuery>;

const getQuery = z
  .object({
    calendar,
    unmask: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    reason: z.string().trim().min(3, 'a reason is required to unmask').max(500).optional(),
  })
  .refine((q) => !q.unmask || q.reason, {
    path: ['reason'],
    message: 'a reason is required to unmask',
  });
type GetQuery = z.infer<typeof getQuery>;

/** Clean records, for any signed-in role. Citizenship numbers are masked unless unmasked. */
@Controller('persons')
export class PersonsController {
  constructor(private readonly persons: PersonsService) {}

  @Get()
  list(@Query(new ZodValidationPipe(listQuery)) query: ListQuery) {
    const { limit, cursor, calendar, ...filter } = query;
    return this.persons.search(filter, limit, cursor, calendar);
  }

  /** ?unmask=true&reason=... shows the full citizenship number to reviewers and auditors. */
  @Get(':id')
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(getQuery)) query: GetQuery,
    @CurrentUser() user: AuthUser,
  ) {
    const unmask = query.unmask ? { reason: query.reason!, user } : undefined;
    return this.persons.get(id, query.calendar, unmask);
  }
}
