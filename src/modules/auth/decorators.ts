import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser, Role } from './auth.types';

export const IS_PUBLIC = 'auth:isPublic';
export const ROLES = 'auth:roles';

/** Every route needs a valid access token unless marked @Public(). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Restricts a route (or controller) to the listed roles. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser =>
    ctx.switchToHttp().getRequest<Request & { user: AuthUser }>().user,
);
