import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { ProblemDetailsFilter } from '../../src/shared/errors/problem-details.filter';
import { requestId } from '../../src/shared/logging/request-id.middleware';

/** HTTP setup shared by main.ts and the API tests, so tests exercise the real configuration. */
export function configureApp(app: INestApplication): INestApplication {
  app.use(requestId);
  app.use(cookieParser());
  app.setGlobalPrefix('api/v1', { exclude: ['health/live', 'health/ready'] });
  app.useGlobalFilters(new ProblemDetailsFilter());
  return app;
}
