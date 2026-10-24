import { Module } from '@nestjs/common';
import { LineageRepository } from './lineage.repository';
import { LineageService } from './lineage.service';

@Module({ providers: [LineageService, LineageRepository], exports: [LineageService] })
export class LineageModule {}
