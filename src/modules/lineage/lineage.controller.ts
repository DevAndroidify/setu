import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { Roles } from '../auth';
import { LineageService } from './lineage.service';

/** Where a record came from: the source rows, mapping version, run and batch behind it. */
@Roles('auditor')
@Controller('persons')
export class LineageController {
  constructor(private readonly lineage: LineageService) {}

  @Get(':id/lineage')
  forPerson(@Param('id', ParseUUIDPipe) id: string) {
    return this.lineage.forPerson(id);
  }
}
