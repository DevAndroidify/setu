import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ZodValidationPipe } from '../../shared/errors/zod-validation.pipe';
import { type AuthUser, CurrentUser, Roles } from '../auth';
import { SourcesService } from './sources.service';
import {
  type CreateSourceRequest,
  createSourceSchema,
  type ListSourcesQuery,
  listSourcesSchema,
  MAX_UPLOAD_BYTES,
} from './sources.types';

@Roles('operator', 'admin')
@Controller('sources')
export class SourcesController {
  constructor(private readonly sources: SourcesService) {}

  @Post()
  create(
    @Body(new ZodValidationPipe(createSourceSchema)) body: CreateSourceRequest,
    @CurrentUser() user: AuthUser,
  ) {
    return this.sources.createSource(body, user);
  }

  /** Registered sources, newest first, with how many files each has. */
  @Get()
  list(@Query(new ZodValidationPipe(listSourcesSchema)) query: ListSourcesQuery) {
    return this.sources.listSources(query.limit, query.cursor);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.sources.getSourceView(id);
  }

  /** The source's uploaded files, newest first, with their profile status. */
  @Get(':id/files')
  files(@Param('id', ParseUUIDPipe) id: string) {
    return this.sources.listFiles(id);
  }

  /** Multipart upload (field "file"). 202: the file is stored; profiling runs in the worker. */
  @Post(':id/files')
  @HttpCode(202)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  upload(
    @Param('id', ParseUUIDPipe) sourceId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    if (!file) throw new BadRequestException('Send the file in a multipart field named "file"');
    return this.sources.upload(sourceId, file, user);
  }
}
