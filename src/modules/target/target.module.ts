import { Module } from '@nestjs/common';
import { TargetRepository } from './target.repository';
import { TargetService } from './target.service';

@Module({ providers: [TargetService, TargetRepository], exports: [TargetService] })
export class TargetModule {}
