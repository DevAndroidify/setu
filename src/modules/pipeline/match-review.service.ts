import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { StagedRow, RawRow } from '@prisma/client';
import { AuditService } from '../audit';
import type { AuthUser } from '../auth';
import { LineageService } from '../lineage/lineage.service';
import { MatchingService } from '../matching';
import { RowValues, TargetService } from '../target/target.service';
import { PipelineRepository } from './pipeline.repository';
import { runStream } from './stages.service';

export type MatchDecisionRequest = { decision: 'link' | 'not_same'; reason: string };

type Row = StagedRow & { rawRow: RawRow };

/** What a reviewer sees of a row. The citizenship number itself is never shown here. */
function summary(row: Row) {
  const v = row.normalized as RowValues;
  return {
    stagedRowId: row.id.toString(),
    runId: row.rawRow.runId,
    rowNo: row.rawRow.rowNo,
    status: row.status,
    name_ne: v.name_ne,
    name_en: v.name_en,
    gender: v.gender,
    dob_ad: v.dob_ad,
    father_name_ne: v.father_name_ne,
    local_unit_code: v.local_unit_code ?? null,
    ward_no: v.ward_no ?? null,
    hasCitizenshipNo: !!v.citizenship_no,
  };
}

/**
 * The duplicate review queue: rows the matcher held because they may be a person already in
 * target. A reviewer links the row to that person, or decides it is someone else, in which
 * case it is loaded as a new person.
 */
@Injectable()
export class MatchReviewService {
  constructor(
    private readonly repo: PipelineRepository,
    private readonly matching: MatchingService,
    private readonly target: TargetService,
    private readonly lineage: LineageService,
    private readonly audit: AuditService,
  ) {}

  async pending(filter: { runId?: string }, limit: number, cursor?: string) {
    const rowIds = filter.runId ? await this.repo.heldRowIds(filter.runId) : undefined;
    const candidates = await this.matching.pending(
      limit,
      cursor ? BigInt(cursor) : undefined,
      rowIds,
    );
    const rows = new Map(
      (await this.repo.stagedRowsWithRaw(candidates.flatMap((c) => [c.rowA, c.rowB]))).map((r) => [
        r.id,
        r,
      ]),
    );
    const data = candidates.map((c) => {
      const { personId: _personId, ...features } = c.features as Record<string, unknown>;
      return {
        id: c.id.toString(),
        score: Number(c.score),
        features,
        row: summary(rows.get(c.rowA)!),
        match: summary(rows.get(c.rowB)!),
      };
    });
    const last = data[data.length - 1];
    return { data, nextCursor: data.length === limit && last ? last.id : null };
  }

  async decide(id: bigint, request: MatchDecisionRequest, user: AuthUser) {
    return this.repo.transaction(async (tx) => {
      const candidate = await this.matching.lockPending(tx, id);
      if (!candidate) throw new NotFoundException('No pending match with this id');
      await this.repo.lockStagedRow(tx, candidate.rowA);
      const [row, other] = await Promise.all([
        this.repo.stagedRowsWithRaw([candidate.rowA], tx).then((r) => r[0]!),
        this.repo.stagedRowsWithRaw([candidate.rowB], tx).then((r) => r[0]!),
      ]);
      const run = (await this.repo.findRun(row.rawRow.runId, tx))!;
      if (run.status !== 'completed') {
        throw new ConflictException(
          `Matches can be decided once the run has completed (it is ${run.status})`,
        );
      }
      if (row.status !== 'duplicate_review') {
        throw new ConflictException('The row is no longer held for review');
      }

      const link = {
        targetTable: 'persons',
        rawRowId: row.rawRowId,
        mappingId: run.mappingId,
        runId: run.id,
        batchId: row.rawRow.batchId,
      };
      if (request.decision === 'link') {
        const personId = (await this.lineage.personsForRawRows([other.rawRowId])).get(
          other.rawRowId,
        );
        if (!personId || other.status !== 'loaded') {
          throw new ConflictException(
            'The matched record is not in target, so the row cannot be linked to it',
          );
        }
        await this.lineage.record(tx, [{ ...link, targetId: personId }]);
        await this.repo.setStagedStatus(tx, [row.id], 'linked');
      } else {
        const values = row.normalized as RowValues;
        if (
          values.citizenship_no &&
          (await this.target.existingCitizenshipNos(tx, [values.citizenship_no])).size
        ) {
          throw new ConflictException(
            'Its citizenship number belongs to a person in target: link it instead',
          );
        }
        const persons = await this.target.insertPersons(tx, run.id, [
          { rawRowId: row.rawRowId, values },
        ]);
        await this.lineage.record(tx, [{ ...link, targetId: persons.get(row.rawRowId)! }]);
        await this.repo.setStagedStatus(tx, [row.id], 'loaded');
      }
      await this.matching.decide(tx, id, request.decision, user.id);
      await this.audit.append(
        {
          stream: runStream(run.id),
          actorId: user.id,
          action: 'match.decided',
          entity: 'match_candidate',
          entityId: id.toString(),
          payload: {
            decision: request.decision,
            score: Number(candidate.score),
            rowNo: row.rawRow.rowNo,
          },
          reason: request.reason,
        },
        tx,
      );
      return {
        id: id.toString(),
        decision: request.decision,
        rowStatus: request.decision === 'link' ? 'linked' : 'loaded',
      };
    });
  }
}
