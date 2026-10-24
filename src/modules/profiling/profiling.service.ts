import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CsvError } from 'csv-parse';
import { StorageService } from '../../shared/storage/storage.service';
import { AuditService, GLOBAL_STREAM } from '../audit';
import { CsvConnector, SourcesService, TextEncoding } from '../sources';
import { FileProfiler, ProfileReport } from './column-profiler';
import { ProfilingRepository } from './profiling.repository';

export type FailedProfile = { status: 'failed'; encoding: string; error: string };

@Injectable()
export class ProfilingService {
  private readonly logger = new Logger(ProfilingService.name);

  constructor(
    private readonly repo: ProfilingRepository,
    private readonly sources: SourcesService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Streams a stored file through its connector and saves the profile. Idempotent: a retried
   * job finds the saved profile and stops. A malformed file is a data problem, not a reason to
   * retry, so it is saved as a failed profile with the parser's message.
   */
  async profileFile(sourceFileId: string): Promise<void> {
    if (await this.repo.findByFile(sourceFileId)) return;
    const file = await this.sources.getFile(sourceFileId);
    const encoding = (file.encoding ?? 'utf-8') as TextEncoding;

    let report: ProfileReport | FailedProfile;
    try {
      const profiler = new FileProfiler();
      const connector = new CsvConnector(await this.storage.stream(file.objectKey), encoding);
      for await (const row of connector.read()) profiler.add(row.values);
      report = profiler.report(encoding);
    } catch (err) {
      if (!(err instanceof CsvError)) throw err; // infrastructure: let the queue retry
      report = { status: 'failed', encoding, error: err.message };
    }

    await this.repo.transaction(async (tx) => {
      await this.repo.create(tx, sourceFileId, report);
      if (report.status === 'ok')
        await this.sources.recordRowCount(tx, sourceFileId, report.rowCount);
      await this.audit.append(
        {
          stream: GLOBAL_STREAM,
          action: report.status === 'ok' ? 'source_file.profiled' : 'source_file.profile_failed',
          entity: 'source_file',
          entityId: sourceFileId,
          payload: report.status === 'ok' ? { rowCount: report.rowCount } : { error: report.error },
        },
        tx,
      );
    });
    this.logger.log(`profiled file ${sourceFileId}: ${report.status}`);
  }

  async getProfile(sourceFileId: string): Promise<ProfileReport | FailedProfile> {
    await this.sources.getFile(sourceFileId); // 404 for an unknown file
    const profile = await this.repo.findByFile(sourceFileId);
    if (!profile) throw new NotFoundException('The profile is not ready yet; try again shortly');
    return profile.report as ProfileReport | FailedProfile;
  }
}
