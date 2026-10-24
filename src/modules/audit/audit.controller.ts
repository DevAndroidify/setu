import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../shared/errors/zod-validation.pipe';
import { Roles } from '../auth/decorators';
import { AuditService } from './audit.service';

const listQuery = z.object({
  stream: z.string().min(1).optional(),
  entity: z.string().min(1).optional(),
  entityId: z.string().min(1).optional(),
  action: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

const verifyQuery = z.object({ stream: z.string().min(1).optional() });

const encodeCursor = (stream: string, seq: number): string =>
  Buffer.from(JSON.stringify([stream, seq])).toString('base64url');

function decodeCursor(cursor: string): { stream: string; seq: number } {
  try {
    const [stream, seq] = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as unknown[];
    if (typeof stream === 'string' && Number.isInteger(seq)) return { stream, seq: seq as number };
  } catch {
    // fall through
  }
  throw new BadRequestException('Invalid cursor');
}

@Roles('auditor', 'admin')
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get('events')
  async list(@Query(new ZodValidationPipe(listQuery)) query: z.infer<typeof listQuery>) {
    const { limit, cursor, ...filter } = query;
    const data = await this.audit.list(filter, limit, cursor ? decodeCursor(cursor) : undefined);
    const last = data[data.length - 1];
    return {
      data,
      nextCursor: data.length === limit && last ? encodeCursor(last.stream, last.seq) : null,
    };
  }

  @Get('verify')
  verify(@Query(new ZodValidationPipe(verifyQuery)) query: z.infer<typeof verifyQuery>) {
    return this.audit.verify(query.stream);
  }
}
