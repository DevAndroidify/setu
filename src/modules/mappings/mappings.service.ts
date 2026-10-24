import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { Mapping } from '@prisma/client';
import { AuditService, GLOBAL_STREAM } from '../audit';
import type { AuthUser } from '../auth';
import { SourcesService } from '../sources';
import { todayInNepal } from '../validation';
import { compileMapping, CompiledMapping, mapRow, MappedRow } from './mapping-engine';
import { MappingSpec, mappingSpecSchema } from './mapping-spec';
import { MappingsRepository } from './mappings.repository';

export const PREVIEW_MAX_ROWS = 50;

export type PreviewRow = MappedRow & { rowNo: number; raw: Record<string, string> };

@Injectable()
export class MappingsService {
  constructor(
    private readonly repo: MappingsRepository,
    private readonly sources: SourcesService,
    private readonly audit: AuditService,
  ) {}

  async create(sourceId: string, spec: MappingSpec, user: AuthUser): Promise<Mapping> {
    await this.sources.getSource(sourceId); // 404 for an unknown source
    return this.repo.transaction(async (tx) => {
      const mapping = await this.repo.createNextVersion(tx, sourceId, spec, user.id);
      await this.audit.append(
        {
          stream: GLOBAL_STREAM,
          actorId: user.id,
          action: 'mapping.created',
          entity: 'mapping',
          entityId: mapping.id,
          payload: { sourceId, version: mapping.version },
        },
        tx,
      );
      return mapping;
    });
  }

  async get(id: string): Promise<Mapping> {
    const mapping = await this.repo.find(id);
    if (!mapping) throw new NotFoundException('Mapping not found');
    return mapping;
  }

  list(sourceId: string): Promise<Mapping[]> {
    return this.repo.listForSource(sourceId);
  }

  /** The stored spec, compiled. Specs are validated before saving, so this cannot fail. */
  compile(mapping: Mapping): CompiledMapping {
    return compileMapping(mappingSpecSchema.parse(mapping.spec));
  }

  /** Runs a mapping over the first rows of a stored file. Writes nothing. */
  async preview(mappingId: string, sourceFileId: string, limit: number) {
    const mapping = await this.get(mappingId);
    const file = await this.sources.getFile(sourceFileId);
    if (file.sourceId !== mapping.sourceId) {
      throw new UnprocessableEntityException(
        'The file belongs to a different source than the mapping',
      );
    }
    const compiled = this.compile(mapping);
    const ctx = { today: todayInNepal() };

    const rows: PreviewRow[] = [];
    for await (const row of await this.sources.readRows(file)) {
      if (rows.length === 0) this.checkColumns(compiled, Object.keys(row.values));
      rows.push({ rowNo: row.rowNo, raw: row.values, ...mapRow(row.values, compiled, ctx) });
      if (rows.length >= limit) break;
    }
    const quarantined = rows.filter((r) => r.status === 'quarantined').length;
    return {
      mappingId,
      version: mapping.version,
      sourceFileId,
      summary: { rows: rows.length, valid: rows.length - quarantined, quarantined },
      rows,
    };
  }

  private checkColumns(mapping: CompiledMapping, header: string[]): void {
    const missing = mapping.columns.filter((c) => !header.includes(c));
    if (missing.length) {
      throw new UnprocessableEntityException(
        `The mapping reads columns the file does not have: ${missing.join(', ')}`,
      );
    }
  }
}
