import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createServer, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ENV } from '../shared/config/config.module';
import type { Env } from '../shared/config/env.schema';
import { Metrics } from '../shared/metrics/metrics';

/** Serves the worker's Prometheus metrics; the worker has no other HTTP server. */
@Injectable()
export class MetricsServer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MetricsServer.name);
  private server?: Server;

  constructor(
    private readonly metrics: Metrics,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** The port actually bound (useful when configured as 0). */
  get port(): number {
    return (this.server?.address() as AddressInfo | null)?.port ?? 0;
  }

  async onModuleInit(): Promise<void> {
    this.server = createServer((req, res) => {
      if (req.url !== '/metrics') {
        res.writeHead(404).end();
        return;
      }
      this.metrics.registry
        .metrics()
        .then((body) =>
          res.writeHead(200, { 'Content-Type': this.metrics.registry.contentType }).end(body),
        )
        .catch(() => res.writeHead(500).end());
    });
    await new Promise<void>((resolve) =>
      this.server!.listen(this.env.WORKER_METRICS_PORT, resolve),
    );
    this.logger.log(`metrics on port ${this.port}`);
  }

  async onModuleDestroy(): Promise<void> {
    await new Promise<void>((resolve) =>
      this.server ? this.server.close(() => resolve()) : resolve(),
    );
  }
}
