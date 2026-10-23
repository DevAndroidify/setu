import { Module } from '@nestjs/common';
import { HealthModule } from '../../src/modules/health/health.module';
import { ConfigModule } from '../../src/shared/config/config.module';
import { DbModule } from '../../src/shared/db/db.module';
import { RedisModule } from '../../src/shared/queue/redis.module';

@Module({ imports: [ConfigModule, DbModule, RedisModule, HealthModule] })
export class ApiModule {}
