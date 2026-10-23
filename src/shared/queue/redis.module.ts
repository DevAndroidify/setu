import { Global, Inject, Injectable, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env.schema';

export const REDIS = Symbol('REDIS');

@Injectable()
class RedisShutdown implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}
  onApplicationShutdown(): void {
    this.redis.disconnect();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ENV],
      useFactory: (env: Env) => {
        const logger = new Logger('Redis');
        const client = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1 });
        // Without an error listener, a dropped connection would crash the process.
        client.on('error', (err: Error) => logger.warn(`connection error: ${err.message}`));
        return client;
      },
    },
    RedisShutdown,
  ],
  exports: [REDIS],
})
export class RedisModule {}
