import { Injectable } from '@nestjs/common';
import type { Gender, Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/db/prisma.service';

export type Tx = Prisma.TransactionClient;

export type NewPerson = {
  id: string;
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

  async existingCitizenshipNos(tx: Tx, numbers: string[]): Promise<Set<string>> {
    if (numbers.length === 0) return new Set();
    const rows = await tx.person.findMany({
      where: { citizenshipNo: { in: numbers } },
      select: { citizenshipNo: true },
    });
    return new Set(rows.map((r) => r.citizenshipNo!));
  }

  /** Inserts persons; returns how many were new. Existing ids (a retried load) are skipped. */
  async insertPersons(tx: Tx, persons: NewPerson[]): Promise<number> {
    if (persons.length === 0) return 0;
    const { count } = await tx.person.createMany({ data: persons, skipDuplicates: true });
    return count;
  }
}
