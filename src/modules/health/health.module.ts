import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { MetricsController } from './metrics.controller';

@Module({
  controllers: [HealthController, MetricsController],
  providers: [HealthService],
  exports: [HealthService],
})
export class HealthModule {}
