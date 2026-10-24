import { Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';
import { PrismaService } from '../../shared/db/prisma.service';

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  findUserByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  findUserById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  /**
   * Counts a failed login in one statement (safe under concurrent attempts). On reaching the
   * limit the account is locked and the counter starts again. Returns true if this attempt
   * locked the account.
   */
  async recordFailedLogin(
    userId: string,
    maxAttempts: number,
    lockMinutes: number,
  ): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<{ locked: boolean }[]>`
      UPDATE control.users SET
        failed_logins = CASE WHEN failed_logins + 1 >= ${maxAttempts} THEN 0 ELSE failed_logins + 1 END,
        locked_until  = CASE WHEN failed_logins + 1 >= ${maxAttempts}
                             THEN now() + ${lockMinutes} * interval '1 minute' ELSE locked_until END
      WHERE id = ${userId}::uuid
      RETURNING failed_logins = 0 AS locked`;
    return rows[0]?.locked ?? false;
  }

  async clearFailedLogins(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { failedLogins: 0, lockedUntil: null },
    });
  }

  async createRefreshToken(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    await this.prisma.refreshToken.create({ data: { userId, tokenHash, expiresAt } });
  }

  findRefreshToken(tokenHash: string) {
    return this.prisma.refreshToken.findUnique({ where: { tokenHash }, include: { user: true } });
  }

  /** Revokes the token unless it is already revoked; false means someone else used it first. */
  async revokeIfActive(id: string): Promise<boolean> {
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return count === 1;
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
