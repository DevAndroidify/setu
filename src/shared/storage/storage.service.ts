import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  BucketAlreadyOwnedByYou,
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env.schema';

/** S3-compatible object storage (MinIO locally, AWS S3 later with the same calls). */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(@Inject(ENV) env: Env) {
    this.bucket = env.S3_BUCKET;
    this.s3 = new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: 'us-east-1', // required by the SDK; MinIO ignores it
      forcePathStyle: true,
      credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return;
    } catch {
      // Missing: create it below.
    }
    try {
      await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket }));
      this.logger.log(`created bucket ${this.bucket}`);
    } catch (err) {
      // The API and worker start together; whichever loses the race finds the bucket made.
      if (!(err instanceof BucketAlreadyOwnedByYou)) throw err;
    }
  }

  /** Stores bytes under a key. Keys are content hashes, so an object is never overwritten. */
  async put(key: string, body: Buffer, sha256: string): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ChecksumSHA256: Buffer.from(sha256, 'hex').toString('base64'),
      }),
    );
  }

  async stream(key: string): Promise<Readable> {
    const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!(res.Body instanceof Readable)) throw new Error(`object ${key} has no readable body`);
    return res.Body;
  }

  onModuleDestroy(): void {
    this.s3.destroy();
  }
}
