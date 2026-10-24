import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type Redis from 'ioredis';
import { ENV } from '../../shared/config/config.module';
import type { Env } from '../../shared/config/env.schema';
import { REDIS } from '../../shared/queue/redis.module';

const WINDOW_SECONDS = 60;

/**
 * Limits /auth/* requests per client IP address per minute, counted in Redis so the limit
 * holds across API instances. Slows password guessing on top of the per-account lockout.
 */
@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const now = Math.floor(Date.now() / 1000);
    const window = Math.floor(now / WINDOW_SECONDS);
    const key = `ratelimit:auth:${req.ip ?? 'unknown'}:${window}`;

    const [[, count]] = (await this.redis.multi().incr(key).expire(key, WINDOW_SECONDS).exec()) as [
      [Error | null, number],
    ];
    if (count <= this.env.AUTH_RATE_LIMIT_PER_MINUTE) return true;

    const retryAfter = WINDOW_SECONDS - (now % WINDOW_SECONDS);
    http.getResponse<Response>().setHeader('Retry-After', String(retryAfter));
    throw new HttpException(
      `Too many sign-in requests from this address; try again in ${retryAfter} seconds`,
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
