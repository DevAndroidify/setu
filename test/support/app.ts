import { INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ApiModule } from '../../apps/api/api.module';
import { configureApp } from '../../apps/api/configure-app';

/** Boots the real API module with production HTTP configuration (prefix, filters, cookies). */
export async function startApi(
  options: { controllers?: Type[]; env?: Record<string, string> } = {},
): Promise<INestApplication> {
  Object.assign(process.env, options.env);
  const moduleRef = await Test.createTestingModule({
    imports: [ApiModule],
    controllers: options.controllers ?? [],
  }).compile();
  const app = configureApp(moduleRef.createNestApplication());
  await app.init();
  return app;
}
