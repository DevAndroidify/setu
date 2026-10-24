import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PersonsController } from './persons.controller';
import { PersonsService } from './persons.service';
import { TargetRepository } from './target.repository';
import { TargetService } from './target.service';

@Module({
  imports: [AuditModule],
  controllers: [PersonsController],
  providers: [TargetService, PersonsService, TargetRepository],
  exports: [TargetService],
})
export class TargetModule {}
