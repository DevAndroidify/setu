import { Injectable } from '@nestjs/common';
import type { Gender } from '@prisma/client';
import { createHash } from 'node:crypto';
import { AddressReference, buildAddressReference } from '../transforms';
import { NewHousehold, NewPerson, TargetRepository, Tx } from './target.repository';

export type PersonValues = {
  name_ne: string;
  name_en: string;
  gender: string | null;
  dob_ad: string | null;
  citizenship_no: string | null;
  father_name_ne: string | null;
};

/** A normalized row: the person plus their household address, when the mapping has one. */
export type RowValues = PersonValues & {
  household_no?: string | null;
  local_unit_code?: string | null;
  ward_no?: string | null;
  tole?: string | null;
};

/**
 * The person id is derived from the raw row it came from, so loading the same row twice can
 * only ever produce one person.
 */
export function personIdFor(rawRowId: bigint): string {
  const hex = createHash('sha256').update(`setu:person:${rawRowId}`).digest('hex');
  return uuidFromHex(hex);
}

/**
 * A household is the legacy household number within one run, so every batch of the run that
 * holds a member arrives at the same household, and another run never shares it.
 */
export function householdIdFor(runId: string, householdNo: string): string {
  return uuidFromHex(
    createHash('sha256').update(`setu:household:${runId}:${householdNo}`).digest('hex'),
  );
}

const uuidFromHex = (hex: string): string =>
  `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;

@Injectable()
export class TargetService {
  constructor(private readonly repo: TargetRepository) {}

  /** The VDC crosswalk and ward counts, for the address transform and ward rule. */
  async addressReference(): Promise<AddressReference> {
    const { units, vdcs } = await this.repo.addressReference();
    return buildAddressReference(units, vdcs);
  }

  existingCitizenshipNos(tx: Tx, numbers: string[]): Promise<Set<string>> {
    return this.repo.existingCitizenshipNos(tx, numbers);
  }

  /** Ids of the persons a run created (not the ones it only linked to). */
  async personIdsCreatedByRun(runId: string): Promise<string[]> {
    return (await this.repo.personsCreatedByRun(runId)).map((p) => p.id);
  }

  /** person id -> stored values, read back from target for reconciliation. */
  async valuesForRun(runId: string): Promise<Map<string, PersonValues>> {
    const persons = await this.repo.personsCreatedByRun(runId);
    return new Map(
      persons.map((p) => [
        p.id,
        {
          name_ne: p.nameNe,
          name_en: p.nameEn,
          gender: p.gender,
          dob_ad: p.dobAd ? p.dobAd.toISOString().slice(0, 10) : null,
          citizenship_no: p.citizenshipNo,
          father_name_ne: p.fatherNameNe,
        },
      ]),
    );
  }

  /** Deletes the given persons that this run created; persons it only linked to stay. */
  deletePersons(tx: Tx, ids: string[], runId: string): Promise<number> {
    return this.repo.deletePersons(tx, ids, runId);
  }

  /** After a rollback has removed the run's persons, removes the households it created. */
  deleteHouseholdsForRun(tx: Tx, runId: string): Promise<number> {
    return this.repo.deleteHouseholdsForRun(tx, runId);
  }

  /**
   * Makes the member from the earliest source row the head of each household the run created.
   * Called once every batch is loaded, so the result does not depend on batch order.
   */
  async setHouseholdHeads(
    tx: Tx,
    runId: string,
    loaded: { rawRowId: bigint; householdNo: string | null }[],
  ): Promise<void> {
    const first = new Map<string, bigint>();
    for (const { rawRowId, householdNo } of loaded) {
      if (!householdNo) continue;
      const current = first.get(householdNo);
      if (current === undefined || rawRowId < current) first.set(householdNo, rawRowId);
    }
    await this.repo.setHouseholdHeads(
      tx,
      [...first].map(([no, rawRowId]) => ({
        householdId: householdIdFor(runId, no),
        personId: personIdFor(rawRowId),
      })),
    );
  }

  /**
   * Loads validated persons, and the households they belong to, in the caller's transaction. Fails (so the batch retries) if any
   * row was not inserted, e.g. another batch took the same citizenship number at the same time.
   */
  async insertPersons(
    tx: Tx,
    runId: string,
    rows: { rawRowId: bigint; values: RowValues }[],
  ): Promise<Map<bigint, string>> {
    const households = new Map<string, NewHousehold>();
    for (const { values } of [...rows].sort((a, b) => (a.rawRowId < b.rawRowId ? -1 : 1))) {
      const no = values.household_no;
      if (!no || !values.local_unit_code || !values.ward_no) continue;
      const id = householdIdFor(runId, no);
      // The first member's address stands for the household.
      if (!households.has(id)) {
        households.set(id, {
          id,
          localUnitCode: values.local_unit_code,
          wardNo: Number(values.ward_no),
          tole: values.tole ?? null,
          createdByRun: runId,
        });
      }
    }
    await this.repo.insertHouseholds(tx, [...households.values()]);

    const persons: NewPerson[] = rows.map(({ rawRowId, values }) => ({
      id: personIdFor(rawRowId),
      householdId: values.household_no ? householdIdFor(runId, values.household_no) : null,
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
