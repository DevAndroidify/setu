/**
 * Loads the address reference data (local units and the old VDC crosswalk) from
 * prisma/reference/address.json. Safe to run repeatedly: rows are upserted by their keys.
 *
 * Usage: npm run db:reference
 */
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import data from './address.json';

const referenceSchema = z.object({
  localUnits: z.array(
    z.object({
      code: z.string().min(1),
      nameEn: z.string().min(1),
      nameNe: z.string().min(1),
      districtCode: z.string().min(1),
      province: z.number().int().min(1).max(7),
      type: z.enum([
        'metropolitan_city',
        'sub_metropolitan_city',
        'municipality',
        'rural_municipality',
      ]),
      wardCount: z.number().int().min(1),
    }),
  ),
  legacyVdcs: z.array(
    z.object({
      nameEn: z.string().min(1),
      nameNe: z.string().min(1),
      districtCode: z.string().min(1),
      localUnitCode: z.string().min(1).nullable(),
    }),
  ),
});

export async function loadReferenceData(
  prisma: PrismaClient,
): Promise<{ units: number; vdcs: number }> {
  const { localUnits, legacyVdcs } = referenceSchema.parse(data);
  await prisma.$transaction(async (tx) => {
    for (const unit of localUnits) {
      await tx.localUnit.upsert({ where: { code: unit.code }, create: unit, update: unit });
    }
    for (const vdc of legacyVdcs) {
      await tx.legacyVdc.upsert({
        where: { districtCode_nameEn: { districtCode: vdc.districtCode, nameEn: vdc.nameEn } },
        create: vdc,
        update: vdc,
      });
    }
  });
  return { units: localUnits.length, vdcs: legacyVdcs.length };
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const { units, vdcs } = await loadReferenceData(prisma);
    console.log(`loaded ${units} local units and ${vdcs} legacy VDCs`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) void main();
