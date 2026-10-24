import { Module } from '@nestjs/common';
import { QuarantineController } from './quarantine.controller';
import { QuarantineRepository } from './quarantine.repository';
import { QuarantineService } from './quarantine.service';

@Module({
  controllers: [QuarantineController],
  providers: [QuarantineService, QuarantineRepository],
  exports: [QuarantineService],
})
export class QuarantineModule {}
