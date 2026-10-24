import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Gives every request a correlation ID: the caller's X-Request-Id if it is safe to echo,
 * otherwise a new one. It is returned in the X-Request-Id response header.
 */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  const id = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
  res.locals.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
}
