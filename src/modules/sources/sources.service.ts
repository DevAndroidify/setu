import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { Prisma, Source, SourceFile } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PROFILE_QUEUE, type ProfileQueue } from '../../shared/queue/queues';
import { StorageService } from '../../shared/storage/storage.service';
import { AuditService, GLOBAL_STREAM } from '../audit';
import type { AuthUser } from '../auth';
import {
  connectorFor,
  declaredXmlEncoding,
  isTextKind,
  RawRow,
  workbookProblem,
} from './connectors';
import { detectEncoding, looksBinary, SNIFF_BYTES, TextEncoding } from './connectors/encoding';
import { SourcesRepository, Tx } from './sources.repository';
import {
  CreateSourceRequest,
  SourceFileView,
  UPLOADABLE_KINDS,
  UploadedFile,
} from './sources.types';

const toView = (file: SourceFile): SourceFileView => ({
  id: file.id,
  sourceId: file.sourceId,
  filename: file.filename,
  sha256: file.sha256,
  sizeBytes: Number(file.sizeBytes),
  encoding: file.encoding,
  rowCount: file.rowCount,
  createdAt: file.createdAt,
});

@Injectable()
export class SourcesService {
  constructor(
    private readonly repo: SourcesRepository,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    @Inject(PROFILE_QUEUE) private readonly profileQueue: ProfileQueue,
  ) {}

  createSource(input: CreateSourceRequest, user: AuthUser) {
    return this.repo.transaction(async (tx) => {
      const source = await this.repo.createSource(tx, { ...input, createdBy: user.id });
      await this.audit.append(
        {
          stream: GLOBAL_STREAM,
          actorId: user.id,
          action: 'source.created',
          entity: 'source',
          entityId: source.id,
          payload: { ...input },
        },
        tx,
      );
      return source;
    });
  }

  /**
   * Stores an uploaded legacy file immutably (keyed by its SHA-256), records it, and queues
   * profiling. The same bytes can only ever be imported once.
   */
  async upload(sourceId: string, file: UploadedFile, user: AuthUser): Promise<SourceFileView> {
    const source = await this.repo.findSource(sourceId);
    if (!source) throw new NotFoundException('Source not found');
    if (!UPLOADABLE_KINDS.has(source.kind)) {
      throw new UnprocessableEntityException(`Uploading ${source.kind} files is not supported yet`);
    }
    if (file.size === 0) throw new BadRequestException('The file is empty');

    // Judge the content, not the file name.
    const sample = file.buffer.subarray(0, SNIFF_BYTES);
    let encoding: TextEncoding | null = null;
    if (isTextKind(source.kind)) {
      const declared = source.kind === 'xml' ? declaredXmlEncoding(sample) : null;
      if (declared === 'unsupported') {
        throw new UnsupportedMediaTypeException(
          'The XML declares an encoding Setu cannot read (use UTF-8 or Windows-1252)',
        );
      }
      // A byte-order mark beats the declaration; the declaration beats guessing.
      const sniffed = detectEncoding(sample);
      encoding = declared && !sniffed.startsWith('utf-16') ? declared : sniffed;
      if (looksBinary(sample, encoding)) {
        throw new UnsupportedMediaTypeException(`The file is not a text (${source.kind}) file`);
      }
    } else {
      const problem = workbookProblem(sample);
      if (problem) throw new UnsupportedMediaTypeException(problem);
    }

    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const existing = await this.repo.findFileBySha256(sha256);
    if (existing) throw this.duplicate(existing.id);

    const objectKey = `sources/${sourceId}/${sha256}`;
    await this.storage.put(objectKey, file.buffer, sha256);

    let created: SourceFile;
    try {
      created = await this.repo.transaction(async (tx) => {
        const row = await this.repo.createFile(tx, {
          sourceId,
          filename: file.originalname,
          objectKey,
          sha256,
          sizeBytes: file.size,
          encoding,
          uploadedBy: user.id,
        });
        await this.audit.append(
          {
            stream: GLOBAL_STREAM,
            actorId: user.id,
            action: 'source_file.uploaded',
            entity: 'source_file',
            entityId: row.id,
            payload: {
              sourceId,
              filename: file.originalname,
              sha256,
              sizeBytes: file.size,
              encoding,
            },
          },
          tx,
        );
        return row;
      });
    } catch (err) {
      // Two uploads of the same file at once: the unique index lets only one through.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const winner = await this.repo.findFileBySha256(sha256);
        throw this.duplicate(winner?.id);
      }
      throw err;
    }

    await this.profileQueue.add('profile', { sourceFileId: created.id }, { jobId: created.id });
    return toView(created);
  }

  async getSource(id: string): Promise<Source> {
    const source = await this.repo.findSource(id);
    if (!source) throw new NotFoundException('Source not found');
    return source;
  }

  async getFile(id: string): Promise<SourceFile> {
    const file = await this.repo.findFile(id);
    if (!file) throw new NotFoundException('File not found');
    return file;
  }

  /**
   * Streams a stored file's rows through the connector for its source's kind (text formats
   * decoded with the encoding detected at upload). Stopping early (e.g. after 50 rows) closes
   * the download.
   */
  async readRows(file: SourceFile): Promise<AsyncIterable<RawRow>> {
    const source = await this.getSource(file.sourceId);
    const encoding = (file.encoding ?? 'utf-8') as TextEncoding;
    return connectorFor(source.kind, await this.storage.stream(file.objectKey), encoding).read();
  }

  recordRowCount(tx: Tx, id: string, rowCount: number): Promise<void> {
    return this.repo.setRowCount(tx, id, rowCount);
  }

  private duplicate(existingId?: string) {
    return new ConflictException(
      `This file was already uploaded${existingId ? ` (file ${existingId})` : ''}`,
    );
  }
}
