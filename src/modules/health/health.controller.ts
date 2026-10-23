import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response) {
    const report = await this.health.checkReady();
    if (report.status === 'ok') return report;

    res.status(HttpStatus.SERVICE_UNAVAILABLE).type('application/problem+json');
    return {
      type: 'about:blank',
      title: 'Service Unavailable',
      status: HttpStatus.SERVICE_UNAVAILABLE,
      detail: 'One or more dependencies are not reachable.',
      checks: report.checks,
    };
  }
}
