import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { LoggerModule } from 'nestjs-pino';
import pino from 'pino';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env.schema';

const PERSONAL_FIELDS = [
  'citizenship_no',
  'citizenshipNo',
  'NAGARIKTA_NO',
  'name_ne',
  'name_en',
  'nameNe',
  'nameEn',
  'NAAM',
  'NAAM_EN',
  'father_name_ne',
  'fatherNameNe',
  'BABU_NAAM',
];

/**
 * Personal data never reaches a log: these fields are censored wherever they appear, up to
 * three levels deep. Code should not log them in the first place; this is the safety net.
 */
export const REDACT_PATHS = PERSONAL_FIELDS.flatMap((f) => [f, `*.${f}`, `*.*.${f}`, `*.*.*.${f}`]);

export function pinoOptions(env: Pick<Env, 'LOG_LEVEL'>): pino.LoggerOptions {
  return {
    level: env.LOG_LEVEL,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
  };
}

type Req = IncomingMessage & { id?: unknown; user?: { id: string } };

/**
 * Structured JSON logs (pino) for both processes. HTTP requests are logged with their
 * correlation id, method, path and user, but not the query string (a search may hold a
 * name) or headers (tokens, cookies).
 */
export const LoggingModule = LoggerModule.forRootAsync({
  inject: [ENV],
  useFactory: (env: Env) => {
    const options = {
      ...pinoOptions(env),
      genReqId: (req: IncomingMessage, res: ServerResponse) =>
        (res as ServerResponse & { locals?: { requestId?: string } }).locals?.requestId ??
        randomUUID(),
      customProps: (req: Req) => (req.user ? { userId: req.user.id } : {}),
      serializers: {
        req: (req: { id: unknown; method: string; url: string }) => ({
          id: req.id,
          method: req.method,
          path: req.url.split('?')[0],
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
      autoLogging: { ignore: (req: IncomingMessage) => /^\/(health|metrics)/.test(req.url ?? '') },
    };
    return {
      pinoHttp: env.LOG_FILE
        ? [options, pino.destination({ dest: env.LOG_FILE, sync: true })]
        : options,
    };
  },
});
