import { Global, Inject, Injectable, Module, OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env.schema';

export const PG_POOL = Symbol('PG_POOL');

@Injectable()
class PoolShutdown implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}
  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [ENV],
      useFactory: (env: Env) =>
        new Pool({ connectionString: env.DATABASE_URL, max: 10, connectionTimeoutMillis: 2000 }),
    },
    PoolShutdown,
  ],
  exports: [PG_POOL],
})
export class DbModule {}
