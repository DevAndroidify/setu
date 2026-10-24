import { Injectable } from '@nestjs/common';
import type { Gender, Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/db/prisma.service';

export type Tx = Prisma.TransactionClient;

export type NewHousehold = {
  id: string;
  localUnitCode: string;
  wardNo: number;
  tole: string | null;
  createdByRun: string;
};

export type NewPerson = {
  id: string;
  householdId: string | null;
  nameNe: string;
  nameEn: string;
  gender: Gender | null;
  dobAd: Date | null;
  citizenshipNo: string | null;
  fatherNameNe: string | null;
  createdByRun: string;
};

@Injectable()
export class TargetRepository {
  constructor(private readonly prisma: PrismaService) {}

  async addressReference() {
    const [units, vdcs] = await Promise.all([
      this.prisma.localUnit.findMany({
        select: { code: true, wardCount: true, districtCode: true },
      }),
      this.prisma.legacyVdc.findMany({
        select: { districtCode: true, nameEn: true, localUnitCode: true },
      }),
    ]);
    return { units, vdcs };
  }

  /** Inserts households; ones that already exist (made by an earlier batch) are skipped. */
  async insertHouseholds(tx: Tx, households: NewHousehold[]): Promise<void> {
    if (households.length === 0) return;
    await tx.household.createMany({ data: households, skipDuplicates: true });
  }

  /** Sets each household's head, unless it already has one. */
  async setHouseholdHeads(tx: Tx, heads: { householdId: string; personId: string }[]) {
    for (const { householdId, personId } of heads) {
      await tx.household.updateMany({
        where: { id: householdId, headPersonId: null },
        data: { headPersonId: personId },
      });
    }
  }

  async deleteHouseholdsForRun(tx: Tx, runId: string): Promise<number> {
    const { count } = await tx.household.deleteMany({ where: { createdByRun: runId } });
    return count;
  }

  async existingCitizenshipNos(tx: Tx, numbers: string[]): Promise<Set<string>> {
    if (numbers.length === 0) return new Set();
    const rows = await tx.person.findMany({
      where: { citizenshipNo: { in: numbers } },
      select: { citizenshipNo: true },
    });
    return new Set(rows.map((r) => r.citizenshipNo!));
  }

  /** Persons by name (English, case-insensitive, or Nepali) and local unit, in id order. */
  searchPersons(filter: { q?: string; localUnit?: string }, limit: number, afterId?: string) {
    return this.prisma.person.findMany({
      where: {
        ...(filter.q
          ? {
              OR: [
                { nameEn: { contains: filter.q, mode: 'insensitive' } },
                { nameNe: { contains: filter.q } },
              ],
            }
          : {}),
        ...(filter.localUnit ? { household: { localUnitCode: filter.localUnit } } : {}),
        ...(afterId ? { id: { gt: afterId } } : {}),
      },
      orderBy: { id: 'asc' },
      take: limit,
      include: { household: true },
    });
  }

  findPerson(id: string) {
    return this.prisma.person.findUnique({ where: { id }, include: { household: true } });
  }

  personsCreatedByRun(runId: string) {
    return this.prisma.person.findMany({ where: { createdByRun: runId } });
  }

  async deletePersons(tx: Tx, ids: string[], runId: string): Promise<number> {
    if (ids.length === 0) return 0;
    const { count } = await tx.person.deleteMany({
      where: { id: { in: ids }, createdByRun: runId },
    });
    return count;
  }

  /** Inserts persons; returns how many were new. Existing ids (a retried load) are skipped. */
  async insertPersons(tx: Tx, persons: NewPerson[]): Promise<number> {
    if (persons.length === 0) return 0;
    const { count } = await tx.person.createMany({ data: persons, skipDuplicates: true });
    return count;
  }
}
