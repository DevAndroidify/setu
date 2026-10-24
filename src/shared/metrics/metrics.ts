import { Global, Injectable, Module } from '@nestjs/common';
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';

/**
 * Prometheus metrics of one process (API or worker). Each process has its own registry and is
 * scraped on its own: the API on /metrics, the worker on WORKER_METRICS_PORT.
 */
@Injectable()
export class Metrics {
  readonly registry = new Registry();

  readonly rowsProcessed = new Counter({
    name: 'setu_rows_processed_total',
    help: 'Rows that finished a pipeline stage, by stage and outcome',
    labelNames: ['stage', 'status'] as const,
    registers: [this.registry],
  });

  readonly batchDuration = new Histogram({
    name: 'setu_batch_duration_seconds',
    help: 'Time to run one batch through one pipeline stage',
    labelNames: ['stage'] as const,
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
    registers: [this.registry],
  });

  readonly queueWaiting = new Gauge({
    name: 'setu_queue_waiting',
    help: 'Jobs waiting in each queue',
    labelNames: ['queue'] as const,
    registers: [this.registry],
  });

  readonly httpDuration = new Histogram({
    name: 'setu_http_request_duration_seconds',
    help: 'HTTP request duration by method, route and status',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry, prefix: 'setu_' });
  }
}

@Global()
@Module({ providers: [Metrics], exports: [Metrics] })
export class MetricsModule {}
