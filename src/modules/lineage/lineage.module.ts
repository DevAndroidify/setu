import { Module } from '@nestjs/common';
import { LineageController } from './lineage.controller';
import { LineageRepository } from './lineage.repository';
import { LineageService } from './lineage.service';

@Module({
  controllers: [LineageController],
  providers: [LineageService, LineageRepository],
  exports: [LineageService],
})
export class LineageModule {}
