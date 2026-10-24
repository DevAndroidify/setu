import { Module } from '@nestjs/common';
import { MatchingRepository } from './matching.repository';
import { MatchingService } from './matching.service';

@Module({ providers: [MatchingService, MatchingRepository], exports: [MatchingService] })
export class MatchingModule {}
