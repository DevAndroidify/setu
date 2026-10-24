import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import { tamperWithEvent } from '../../tools/tamper-demo';
import { AuditModule } from '../../src/modules/audit/audit.module';
import { AuditService } from '../../src/modules/audit/audit.service';
import { ConfigModule } from '../../src/shared/config/config.module';
import { DbModule } from '../../src/shared/db/db.module';
import { PrismaService } from '../../src/shared/db/prisma.service';
import { uniqueStream } from '../support/db';

describe('AuditService against Postgres', () => {
  let audit: AuditService;
  let prisma: PrismaService;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, DbModule, AuditModule],
    }).compile();
    await moduleRef.init();
    audit = moduleRef.get(AuditService);
    prisma = moduleRef.get(PrismaService);
    close = () => moduleRef.close();
  });

  afterAll(async () => {
    await close();
  });

  const append = (stream: string, n: number) =>
    audit.append({ stream, action: 'test.event', entity: 'test', payload: { n } });

  it('numbers events 1, 2, 3 ... per stream and links each to the previous hash', async () => {
    const stream = uniqueStream();
    const first = await append(stream, 1);
    const second = await append(stream, 2);
    expect(first.seq).toBe(1);
    expect(second.seq).toBe(2);
    expect(second.prevHash).toBe(first.hash);
  });

  it('keeps seq gap-free and the chain valid under 50 concurrent appends', async () => {
    const stream = uniqueStream();
    await Promise.all(Array.from({ length: 50 }, (_, i) => append(stream, i)));

    const rows = await prisma.auditEvent.findMany({ where: { stream }, orderBy: { seq: 'asc' } });
    expect(rows.map((r) => Number(r.seq))).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect(await audit.verify(stream)).toEqual({
      valid: true,
      streamsChecked: 1,
      eventsChecked: 50,
      firstBroken: null,
    });
  });

  it('rolls the audit event back with the caller transaction', async () => {
    const stream = uniqueStream();
    await expect(
      prisma.$transaction(async (tx) => {
        await audit.append({ stream, action: 'test.event', entity: 'test' }, tx);
        throw new Error('business change failed');
      }),
    ).rejects.toThrow('business change failed');
    expect(await prisma.auditEvent.count({ where: { stream } })).toBe(0);
  });

  it('reports the exact seq an owner tampered with', async () => {
    const stream = uniqueStream();
    for (let n = 1; n <= 5; n++) await append(stream, n);

    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      await tamperWithEvent(client, stream, 3);
    } finally {
      await client.end();
    }

    expect(await audit.verify(stream)).toEqual({
      valid: false,
      streamsChecked: 1,
      eventsChecked: 2,
      firstBroken: {
        stream,
        seq: 3,
        reason: 'content does not match its hash (the event was modified)',
      },
    });
  });
});
