import { Readable } from 'node:stream';
import { encodeCp1252, generateRegister } from '../../../../tools/generate-legacy-data';
import { toXml } from '../../../../tools/legacy-formats';
import { CsvConnector, RawRow, SourceConnector } from './csv.connector';
import { SourceFormatError } from './format-error';
import { declaredXmlEncoding, XmlConnector } from './xml.connector';

async function readAll(connector: SourceConnector): Promise<RawRow[]> {
  const rows: RawRow[] = [];
  for await (const row of connector.read()) rows.push(row);
  return rows;
}

/** Tiny chunks, so tags, entities and multi-byte characters straddle chunk boundaries. */
const chunked = (bytes: Buffer, size = 7): Readable =>
  Readable.from(
    Array.from({ length: Math.ceil(bytes.length / size) }, (_, i) =>
      bytes.subarray(i * size, (i + 1) * size),
    ),
  );

const xml = (body: string) => Buffer.from(`<?xml version="1.0"?><rows>${body}</rows>`);

describe('XmlConnector', () => {
  it('reads the same rows from a Windows-1252 XML export as from the CSV of the register', async () => {
    const register = generateRegister({ rows: 300, seed: 22, encoding: 'cp1252' });
    const fromCsv = await readAll(
      new CsvConnector(Readable.from([encodeCp1252(register.csv)]), 'windows-1252'),
    );
    const bytes = encodeCp1252(toXml(register, 'windows-1252'));
    expect(await readAll(new XmlConnector(chunked(bytes), 'windows-1252'))).toEqual(fromCsv);
  });

  it('reads UTF-8 Devanagari split across chunks', async () => {
    const register = generateRegister({ rows: 30, seed: 22, encoding: 'utf8' });
    const bytes = Buffer.from(toXml(register, 'utf-8'), 'utf8');
    const rows = await readAll(new XmlConnector(chunked(bytes, 3), 'utf-8'));
    expect(rows.map((r) => r.values.NAAM)).toEqual(register.rows.map((r) => r[2]));
  });

  it('takes attributes, child elements, CDATA and escaped characters as column values', async () => {
    const rows = await readAll(
      new XmlConnector(
        Readable.from([xml('<r id="7"><A>Naya &amp; Bazar</A><B><![CDATA[<3>]]></B><C/></r>')]),
        'utf-8',
      ),
    );
    expect(rows).toEqual([{ rowNo: 1, values: { id: '7', A: 'Naya & Bazar', B: '<3>', C: '' } }]);
  });

  it('fails on malformed XML instead of guessing', async () => {
    const connector = new XmlConnector(Readable.from([xml('<r><A>1</B></r>')]), 'utf-8');
    await expect(readAll(connector)).rejects.toThrow(SourceFormatError);
  });

  it('does not resolve external entities', async () => {
    const bytes = Buffer.from(
      '<?xml version="1.0"?><!DOCTYPE r [<!ENTITY x SYSTEM "file:///etc/passwd">]><rows><r><A>&x;</A></r></rows>',
    );
    await expect(readAll(new XmlConnector(Readable.from([bytes]), 'utf-8'))).rejects.toThrow(
      SourceFormatError,
    );
  });
});

describe('declaredXmlEncoding', () => {
  it('reads the encoding named in the XML declaration', () => {
    const head = (enc: string) => Buffer.from(`<?xml version="1.0" encoding="${enc}"?><a/>`);
    expect(declaredXmlEncoding(head('windows-1252'))).toBe('windows-1252');
    expect(declaredXmlEncoding(head('ISO-8859-1'))).toBe('windows-1252');
    expect(declaredXmlEncoding(head('UTF-8'))).toBe('utf-8');
    expect(declaredXmlEncoding(head('Shift_JIS'))).toBe('unsupported');
    expect(declaredXmlEncoding(Buffer.from('<a/>'))).toBeNull();
  });
});
