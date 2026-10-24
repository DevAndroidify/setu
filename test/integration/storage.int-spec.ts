import { randomUUID } from 'node:crypto';
import { loadEnv } from '../../src/shared/config/env.schema';
import { StorageService } from '../../src/shared/storage/storage.service';

describe('StorageService against MinIO', () => {
  it('lets the API and worker create the missing bucket at the same time without failing', async () => {
    const env = loadEnv({ ...process.env, S3_BUCKET: `race-${randomUUID()}` });
    const api = new StorageService(env);
    const worker = new StorageService(env);
    try {
      await expect(Promise.all([api.onModuleInit(), worker.onModuleInit()])).resolves.toBeDefined();
    } finally {
      api.onModuleDestroy();
      worker.onModuleDestroy();
    }
  });

  it('stores an object and streams it back unchanged', async () => {
    const env = loadEnv({ ...process.env, S3_BUCKET: `rt-${randomUUID()}` });
    const storage = new StorageService(env);
    await storage.onModuleInit();
    const body = Buffer.from('SN,NAAM\r\n1,/fd yfkf\r\n');
    const sha256 = (await import('node:crypto')).createHash('sha256').update(body).digest('hex');
    await storage.put('k', body, sha256);

    const chunks: Buffer[] = [];
    for await (const chunk of await storage.stream('k')) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks)).toEqual(body);
    storage.onModuleDestroy();
  });
});
