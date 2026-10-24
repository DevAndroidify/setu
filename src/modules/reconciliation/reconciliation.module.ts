import { Module } from '@nestjs/common';
import { ReconciliationController } from './reconciliation.controller';
import { ReconciliationRepository } from './reconciliation.repository';
import { ReconciliationService } from './reconciliation.service';

@Module({
  controllers: [ReconciliationController],
  providers: [ReconciliationService, ReconciliationRepository],
  exports: [ReconciliationService],
})
export class ReconciliationModule {}
