import type { Role } from '@prisma/client';
import { z } from 'zod';

export type { Role };

/** The caller, as established by the access token. */
export type AuthUser = { id: string; role: Role };

export const loginSchema = z.object({
  email: z.email().trim().toLowerCase(),
  password: z.string().min(1).max(200),
});
export type LoginRequest = z.infer<typeof loginSchema>;

export const demoLoginSchema = z.object({
  role: z.enum(['operator', 'reviewer', 'approver', 'auditor', 'admin']),
});
export type DemoLoginRequest = z.infer<typeof demoLoginSchema>;

/** The seeded demo account of a role (prisma/seed.ts creates one per role). */
export const demoEmail = (role: Role): string => `${role}@setu.local`;

export type IssuedTokens = {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
};
