import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../shared/errors/zod-validation.pipe';
import { type AuthUser, CurrentUser, Roles } from '../auth';
import { type MappingSpec, mappingSpecSchema } from './mapping-spec';
import { MappingsService, PREVIEW_MAX_ROWS } from './mappings.service';

const previewSchema = z.object({
  sourceFileId: z.uuid(),
  limit: z.number().int().min(1).max(PREVIEW_MAX_ROWS).default(PREVIEW_MAX_ROWS),
});
type PreviewRequest = z.infer<typeof previewSchema>;

@Roles('operator', 'admin')
@Controller()
export class MappingsController {
  constructor(private readonly mappings: MappingsService) {}

  /** Saves the spec as the source's next mapping version (versions are never edited). */
  @Post('sources/:id/mappings')
  create(
    @Param('id', ParseUUIDPipe) sourceId: string,
    @Body(new ZodValidationPipe(mappingSpecSchema)) spec: MappingSpec,
    @CurrentUser() user: AuthUser,
  ) {
    return this.mappings.create(sourceId, spec, user);
  }

  @Get('sources/:id/mappings')
  list(@Param('id', ParseUUIDPipe) sourceId: string) {
    return this.mappings.list(sourceId);
  }

  @Get('mappings/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.mappings.get(id);
  }

  /** Transforms and validates the first rows of a file, without writing anything. */
  @Post('mappings/:id/preview')
  @HttpCode(200)
  preview(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(previewSchema)) body: PreviewRequest,
  ) {
    return this.mappings.preview(id, body.sourceFileId, body.limit);
  }
}
