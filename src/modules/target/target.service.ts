import { Injectable } from '@nestjs/common';
import type { Gender } from '@prisma/client';
import { createHash } from 'node:crypto';
import { NewPerson, TargetRepository, Tx } from './target.repository';

export type PersonValues = {
  name_ne: string;
  name_en: string;
  gender: string | null;
  dob_ad: string | null;
  citizenship_no: string | null;
  father_name_ne: string | null;
};

/**
 * The person id is derived from the raw row it came from, so loading the same row twice can
 * only ever produce one person.
 */
export function personIdFor(rawRowId: bigint): string {
  const hex = createHash('sha256').update(`setu:person:${rawRowId}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

@Injectable()
export class TargetService {
  constructor(private readonly repo: TargetRepository) {}

  existingCitizenshipNos(tx: Tx, numbers: string[]): Promise<Set<string>> {
    return this.repo.existingCitizenshipNos(tx, numbers);
  }

  /**
   * Loads validated persons in the caller's transaction. Fails (so the batch retries) if any
   * row was not inserted, e.g. another batch took the same citizenship number at the same time.
   */
  async insertPersons(
    tx: Tx,
    runId: string,
    rows: { rawRowId: bigint; values: PersonValues }[],
  ): Promise<Map<bigint, string>> {
    const persons: NewPerson[] = rows.map(({ rawRowId, values }) => ({
      id: personIdFor(rawRowId),
      nameNe: values.name_ne,
      nameEn: values.name_en,
      gender: values.gender as Gender | null,
      dobAd: values.dob_ad ? new Date(`${values.dob_ad}T00:00:00Z`) : null,
      citizenshipNo: values.citizenship_no,
      fatherNameNe: values.father_name_ne,
      createdByRun: runId,
    }));
    const inserted = await this.repo.insertPersons(tx, persons);
    if (inserted !== persons.length) {
      throw new Error(`expected to load ${persons.length} persons, loaded ${inserted}; retrying`);
    }
    return new Map(rows.map((r, i) => [r.rawRowId, persons[i]!.id]));
  }
}
