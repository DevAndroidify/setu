import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AuthUser, Role } from './auth.types';
import { ROLES } from './decorators';

/** Global guard: enforces @Roles(...). Runs after AuthGuard, so req.user is set. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const allowed = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!allowed) return true;
    const { user } = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    if (user && allowed.includes(user.role)) return true;
    throw new ForbiddenException('Your role does not allow this action');
  }
}
