/**
 * Loads the address reference data, then creates one demo user per role (operator@setu.local, reviewer@setu.local, ...), all with the
 * password in SEED_PASSWORD. Safe to run repeatedly: existing users get their password reset.
 *
 * Usage: npm run db:seed
 */
import { PrismaClient, Role } from '@prisma/client';
import { z } from 'zod';
import { hashPassword } from '../src/modules/auth/password';
import { loadReferenceData } from './reference/load-reference';

const env = z
  .object({ SEED_PASSWORD: z.string().min(12, 'SEED_PASSWORD must be at least 12 characters') })
  .parse(process.env);

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const { units, vdcs } = await loadReferenceData(prisma);
    console.log(`loaded ${units} local units and ${vdcs} legacy VDCs`);
    const passwordHash = await hashPassword(env.SEED_PASSWORD);
    for (const role of Object.values(Role)) {
      const email = `${role}@setu.local`;
      await prisma.user.upsert({
        where: { email },
        create: { email, role, passwordHash },
        update: { role, passwordHash, failedLogins: 0, lockedUntil: null },
      });
      console.log(`seeded ${email} (${role})`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main();
