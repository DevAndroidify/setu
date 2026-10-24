import { Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { User } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { ENV } from '../../shared/config/config.module';
import type { Env } from '../../shared/config/env.schema';
import { AuditService, GLOBAL_STREAM } from '../audit';
import { AuthRepository } from './auth.repository';
import type { IssuedTokens, LoginRequest, Role } from './auth.types';
import { hashPassword, verifyPassword } from './password';

export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MINUTES = 15;

// One message for every login failure, so responses never reveal whether an account exists
// or is locked.
const INVALID_LOGIN = 'Invalid email or password';

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

@Injectable()
export class AuthService {
  // Verified against when the email is unknown, so that path takes as long as a real check.
  private readonly dummyHash = hashPassword(randomBytes(16).toString('hex'));

  constructor(
    private readonly repo: AuthRepository,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async login({ email, password }: LoginRequest): Promise<IssuedTokens> {
    const user = await this.repo.findUserByEmail(email);
    if (!user) {
      await verifyPassword(await this.dummyHash, password);
      await this.auditLogin('auth.login_failed', null, { email, cause: 'unknown_email' });
      throw new UnauthorizedException(INVALID_LOGIN);
    }
    const passwordOk = await verifyPassword(user.passwordHash, password);
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await this.auditLogin('auth.login_failed', user.id, { cause: 'account_locked' });
      throw new UnauthorizedException(INVALID_LOGIN);
    }
    if (!passwordOk) {
      const locked = await this.repo.recordFailedLogin(user.id, MAX_FAILED_LOGINS, LOCKOUT_MINUTES);
      await this.auditLogin('auth.login_failed', user.id, { cause: 'wrong_password', locked });
      throw new UnauthorizedException(INVALID_LOGIN);
    }
    if (user.failedLogins > 0 || user.lockedUntil) await this.repo.clearFailedLogins(user.id);
    await this.audit.append({
      stream: GLOBAL_STREAM,
      actorId: user.id,
      action: 'auth.login',
      entity: 'user',
      entityId: user.id,
    });
    return this.issueTokens(user);
  }

  private auditLogin(action: string, userId: string | null, payload: Record<string, unknown>) {
    return this.audit.append({
      stream: GLOBAL_STREAM,
      action,
      entity: 'user',
      entityId: userId,
      payload,
    });
  }

  /**
   * Rotates a refresh token: the presented token is revoked and a new pair issued. Presenting a
   * token that was already revoked means it leaked or was replayed, so every session of that
   * user is revoked.
   */
  async refresh(refreshToken: string): Promise<IssuedTokens> {
    const stored = await this.repo.findRefreshToken(sha256(refreshToken));
    if (!stored) throw new UnauthorizedException('Invalid refresh token');
    if (stored.revokedAt || !(await this.repo.revokeIfActive(stored.id))) {
      await this.repo.revokeAllForUser(stored.userId);
      await this.auditLogin('auth.refresh_token_reused', stored.userId, {
        sessionsRevoked: true,
      });
      throw new UnauthorizedException('Refresh token was already used; all sessions revoked');
    }
    if (stored.expiresAt <= new Date()) throw new UnauthorizedException('Refresh token expired');
    return this.issueTokens(stored.user);
  }

  async currentUser(id: string): Promise<{ id: string; email: string; role: Role }> {
    const user = await this.repo.findUserById(id);
    if (!user) throw new NotFoundException('User no longer exists');
    return { id: user.id, email: user.email, role: user.role };
  }

  private async issueTokens(user: User): Promise<IssuedTokens> {
    const expiresIn = this.env.ACCESS_TOKEN_TTL_SECONDS;
    const accessToken = await this.jwt.signAsync({ sub: user.id, role: user.role }, { expiresIn });
    const refreshToken = randomBytes(32).toString('base64url');
    const refreshExpiresAt = new Date(Date.now() + this.env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
    await this.repo.createRefreshToken(user.id, sha256(refreshToken), refreshExpiresAt);
    return { accessToken, expiresIn, refreshToken, refreshExpiresAt };
  }
}
