import pino from 'pino';
import { Writable } from 'node:stream';
import { pinoOptions } from './logging.module';

function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, done) {
      lines.push(String(chunk));
      done();
    },
  });
  return { logger: pino(pinoOptions({ LOG_LEVEL: 'info' }), stream), lines };
}

describe('log redaction', () => {
  it('censors names and citizenship numbers wherever they appear in a logged object', () => {
    const { logger, lines } = capture();
    logger.info(
      {
        citizenship_no: '85-01-50-00001',
        person: { name_en: 'Sita Magar', name_ne: 'सीता मगर', nameEn: 'Sita Magar' },
        row: { raw: { NAGARIKTA_NO: '85-01-50-00002', NAAM: ';Ltf du/' } },
        batch: { rows: { first: { father_name_ne: 'हरि मगर' } } },
      },
      'loaded',
    );
    const text = lines.join('');
    for (const secret of [
      '85-01-50-00001',
      '85-01-50-00002',
      'Sita Magar',
      'सीता',
      ';Ltf',
      'हरि',
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(text).toContain('[redacted]');
  });

  it('keeps the fields that are not personal', () => {
    const { logger, lines } = capture();
    logger.info({ runId: 'r-1', batchId: 'b-1', rows: 200 }, 'batch done');
    expect(JSON.parse(lines[0]!)).toMatchObject({ runId: 'r-1', batchId: 'b-1', rows: 200 });
  });
});
