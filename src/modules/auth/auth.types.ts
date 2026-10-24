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

export type IssuedTokens = {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
};
