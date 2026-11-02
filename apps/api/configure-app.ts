import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { Logger } from 'nestjs-pino';
import { ENV } from '../../src/shared/config/config.module';
import type { Env } from '../../src/shared/config/env.schema';
import { ProblemDetailsFilter } from '../../src/shared/errors/problem-details.filter';
import { requestId } from '../../src/shared/logging/request-id.middleware';
import { httpMetrics } from '../../src/shared/metrics/http-metrics.middleware';
import { Metrics } from '../../src/shared/metrics/metrics';

/** HTTP setup shared by main.ts and the API tests, so tests exercise the real configuration. */
export function configureApp(app: INestApplication): INestApplication {
  app.useLogger(app.get(Logger));
  // Express's own setting: which X-Forwarded-For hops to believe for req.ip.
  app.getHttpAdapter().getInstance().set('trust proxy', app.get<Env>(ENV).TRUST_PROXY_HOPS);
  app.use(requestId);
  app.use(httpMetrics(app.get(Metrics)));
  app.use(cookieParser());
  app.setGlobalPrefix('api/v1', { exclude: ['health/live', 'health/ready', 'metrics'] });
  app.useGlobalFilters(new ProblemDetailsFilter());
  return app;
}
