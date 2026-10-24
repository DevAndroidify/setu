import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ZodValidationPipe } from '../../shared/errors/zod-validation.pipe';
import { type AuthUser, CurrentUser, Roles } from '../auth';
import { SourcesService } from './sources.service';
import { type CreateSourceRequest, createSourceSchema, MAX_UPLOAD_BYTES } from './sources.types';

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
