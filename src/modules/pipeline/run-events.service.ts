import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type Redis from 'ioredis';
import { filter, map, Observable, Subject } from 'rxjs';
import { REDIS } from '../../shared/queue/redis.module';

/** Something happened to a run: a batch finished a stage, or the run changed status. */
export type RunEvent =
  { type: 'stage'; batchId: string; seq: number; stage: string } | { type: 'run'; status: string };

const PREFIX = 'setu:run:';

/**
 * Progress events over Redis pub/sub: the worker publishes them, the API relays them to the
 * browser (Server-Sent Events). Best effort: a lost event only delays an update, because the
 * stream re-reads the run's status on every event and every few seconds anyway.
 */
@Injectable()
export class RunEventsService implements OnModuleDestroy {
  private readonly logger = new Logger(RunEventsService.name);
  private readonly events = new Subject<{ runId: string; event: RunEvent }>();
  private subscriber?: Redis;

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async publish(runId: string, event: RunEvent): Promise<void> {
    try {
      await this.redis.publish(`${PREFIX}${runId}`, JSON.stringify(event));
    } catch (err) {
      this.logger.warn(`could not publish a progress event: ${(err as Error).message}`);
    }
  }

  /** Events of one run, from now on. One Redis subscription per process serves every stream. */
  stream(runId: string): Observable<RunEvent> {
    this.subscribe();
    return this.events.pipe(
      filter((e) => e.runId === runId),
      map((e) => e.event),
    );
  }

  private subscribe(): void {
    if (this.subscriber) return;
    this.subscriber = this.redis.duplicate();
    this.subscriber.on('error', (err: Error) => this.logger.warn(`subscriber: ${err.message}`));
    this.subscriber.on('pmessage', (_pattern: string, channel: string, message: string) => {
      try {
        this.events.next({ runId: channel.slice(PREFIX.length), event: JSON.parse(message) });
      } catch {
        // not one of ours
      }
    });
    void this.subscriber.psubscribe(`${PREFIX}*`);
  }

  onModuleDestroy(): void {
    this.subscriber?.disconnect();
    this.events.complete();
  }
}
