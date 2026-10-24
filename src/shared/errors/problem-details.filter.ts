import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { STATUS_CODES } from 'node:http';

export type FieldError = { path: string; message: string };

/** Turns every error into an RFC 9457 problem+json response. */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    let status = 500;
    let detail: string | undefined;
    let errors: FieldError[] | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        detail = body;
      } else {
        const { message, errors: fieldErrors } = body as {
          message?: unknown;
          errors?: FieldError[];
        };
        detail = Array.isArray(message) ? message.join('; ') : String(message ?? '');
        errors = fieldErrors;
      }
    } else {
      // Unexpected: log the cause, but never leak internals to the client.
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }

    res
      .status(status)
      .type('application/problem+json')
      .json({
        type: 'about:blank',
        title: STATUS_CODES[status] ?? 'Error',
        status,
        ...(detail ? { detail } : {}),
        ...(errors ? { errors } : {}),
      });
  }
}
