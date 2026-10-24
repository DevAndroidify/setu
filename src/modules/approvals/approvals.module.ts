import { Module } from '@nestjs/common';
import { ApprovalsRepository } from './approvals.repository';
import { ApprovalsService } from './approvals.service';

@Module({ providers: [ApprovalsService, ApprovalsRepository], exports: [ApprovalsService] })
export class ApprovalsModule {}
