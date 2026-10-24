import { Readable } from 'node:stream';
import { encodeCp1252, generateRegister } from '../../../../tools/generate-legacy-data';
import { CsvConnector, RawRow } from './csv.connector';
import { detectEncoding, looksBinary } from './encoding';

async function readAll(connector: CsvConnector): Promise<RawRow[]> {
  const rows: RawRow[] = [];
  for await (const row of connector.read()) rows.push(row);
  return rows;
}

/** Splits bytes into tiny chunks, so multi-byte characters straddle chunk boundaries. */
const chunked = (bytes: Buffer, size = 7): Readable =>
  Readable.from(
    Array.from({ length: Math.ceil(bytes.length / size) }, (_, i) =>
      bytes.subarray(i * size, (i + 1) * size),
    ),
  );

describe('detectEncoding', () => {
  it('recognizes UTF-8, with or without a byte-order mark', () => {
    expect(detectEncoding(Buffer.from('नाम,ward\r\nराम,3', 'utf8'))).toBe('utf-8');
    expect(detectEncoding(Buffer.from('﻿name', 'utf8'))).toBe('utf-8');
  });

  it('recognizes UTF-16 by its byte-order mark', () => {
    expect(detectEncoding(Buffer.from([0xff, 0xfe, 0x41, 0x00]))).toBe('utf-16le');
  });

  it('falls back to Windows-1252 for bytes that are not valid UTF-8', () => {
    expect(detectEncoding(encodeCp1252('‘Shanti’ Tole – Line 2'))).toBe('windows-1252');
  });

  it('does not mistake a UTF-8 character cut at the end of the sample for Windows-1252', () => {
    const bytes = Buffer.from('ab राम', 'utf8');
    expect(detectEncoding(bytes.subarray(0, bytes.length - 1))).toBe('utf-8');
  });

  it('flags NUL bytes as binary content', () => {
    expect(looksBinary(Buffer.from([0x50, 0x4b, 0x00, 0x03]), 'utf-8')).toBe(true);
    expect(looksBinary(Buffer.from('a,b\n1,2'), 'utf-8')).toBe(false);
  });
});

describe('CsvConnector', () => {
  it('reads the generated Windows-1252 register row by row with the right text', async () => {
    const register = generateRegister({ rows: 50, seed: 3, encoding: 'cp1252' });
    const rows = await readAll(
      new CsvConnector(chunked(encodeCp1252(register.csv)), 'windows-1252'),
    );

    expect(rows).toHaveLength(50);
    expect(rows[0]).toEqual({
      rowNo: 1,
      values: Object.fromEntries(register.header.map((h, i) => [h, register.rows[0]![i]])),
    });
    const toles = rows.map((r) => r.values.TOLE);
    expect(toles).toEqual(register.rows.map((r) => r[11]));
  });

  it('decodes UTF-8 Devanagari split across chunk boundaries', async () => {
    const register = generateRegister({ rows: 20, seed: 3, encoding: 'utf8' });
    const rows = await readAll(
      new CsvConnector(chunked(Buffer.from(register.csv, 'utf8'), 3), 'utf-8'),
    );
    expect(rows.map((r) => r.values.NAAM)).toEqual(register.rows.map((r) => r[2]));
  });

  it('handles quoted fields with commas and a byte-order mark', async () => {
    const bytes = Buffer.from('﻿NAME,NOTE\r\n"Thapa, Ram","said ""hi"""\r\n', 'utf8');
    const rows = await readAll(new CsvConnector(Readable.from([bytes]), 'utf-8'));
    expect(rows).toEqual([{ rowNo: 1, values: { NAME: 'Thapa, Ram', NOTE: 'said "hi"' } }]);
  });
});
