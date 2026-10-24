import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ENV } from '../../shared/config/config.module';
import type { Env } from '../../shared/config/env.schema';
import { ZodValidationPipe } from '../../shared/errors/zod-validation.pipe';
import { AuthService } from './auth.service';
import { type AuthUser, type IssuedTokens, type LoginRequest, loginSchema } from './auth.types';
import { CurrentUser, Public } from './decorators';

export const REFRESH_COOKIE = 'setu_refresh';

@Controller()
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Public()
  @Post('auth/login')
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(res, await this.auth.login(body));
  }

  @Public()
  @Post('auth/refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token: unknown = req.cookies?.[REFRESH_COOKIE];
    if (typeof token !== 'string' || token === '') {
      throw new UnauthorizedException('Missing refresh token');
    }
    return this.respond(res, await this.auth.refresh(token));
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.currentUser(user.id);
  }

  /** The refresh token travels only in an httpOnly cookie scoped to the auth routes. */
  private respond(res: Response, tokens: IssuedTokens) {
    res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
      httpOnly: true,
      secure: this.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/api/v1/auth',
      expires: tokens.refreshExpiresAt,
    });
    return { accessToken: tokens.accessToken, tokenType: 'Bearer', expiresIn: tokens.expiresIn };
  }
}
