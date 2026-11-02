import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { Mapping } from '@prisma/client';
import { AuditService, GLOBAL_STREAM } from '../audit';
import type { AuthUser } from '../auth';
import { SourcesService } from '../sources';
import { TargetService } from '../target/target.service';
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
    private readonly target: TargetService,
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

  /**
   * The stored spec, compiled against the current address reference data. Specs are validated
   * before saving, so this cannot fail.
   */
  async compile(mapping: Mapping): Promise<CompiledMapping> {
    return compileMapping(
      mappingSpecSchema.parse(mapping.spec),
      await this.target.addressReference(),
    );
  }

  /** Runs a saved mapping over the first rows of a stored file. Writes nothing. */
  async preview(mappingId: string, sourceFileId: string, limit: number) {
    const mapping = await this.get(mappingId);
    const result = await this.previewSpec(
      mapping.sourceId,
      mappingSpecSchema.parse(mapping.spec),
      sourceFileId,
      limit,
    );
    return { mappingId, version: mapping.version, ...result };
  }

  /**
   * Runs a spec that has not been saved (an editor's draft) over the first rows of one of the
   * source's files. Writes nothing, so trying an edit does not create a version.
   */
  async previewDraft(sourceId: string, spec: MappingSpec, sourceFileId: string, limit: number) {
    await this.sources.getSource(sourceId); // 404 for an unknown source
    return {
      mappingId: null,
      version: null,
      ...(await this.previewSpec(sourceId, spec, sourceFileId, limit)),
    };
  }

  private async previewSpec(
    sourceId: string,
    spec: MappingSpec,
    sourceFileId: string,
    limit: number,
  ) {
    const file = await this.sources.getFile(sourceFileId);
    if (file.sourceId !== sourceId) {
      throw new UnprocessableEntityException(
        'The file belongs to a different source than the mapping',
      );
    }
    const compiled = compileMapping(spec, await this.target.addressReference());
    const ctx = { today: todayInNepal() };

    const rows: PreviewRow[] = [];
    for await (const row of await this.sources.readRows(file)) {
      if (rows.length === 0) this.checkColumns(compiled, Object.keys(row.values));
      rows.push({ rowNo: row.rowNo, raw: row.values, ...mapRow(row.values, compiled, ctx) });
      if (rows.length >= limit) break;
    }
    const quarantined = rows.filter((r) => r.status === 'quarantined').length;
    return {
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
