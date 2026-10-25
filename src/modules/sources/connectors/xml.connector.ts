import { Readable } from 'node:stream';
import { SaxesParser } from 'saxes';
import type { RawRow, SourceConnector } from './csv.connector';
import type { TextEncoding } from './encoding';
import { SourceFormatError } from './format-error';

const ALIASES: Record<string, TextEncoding> = {
  'utf-8': 'utf-8',
  utf8: 'utf-8',
  'us-ascii': 'utf-8',
  'windows-1252': 'windows-1252',
  cp1252: 'windows-1252',
  // Windows-1252 is a superset of Latin-1 for every byte legacy exports use.
  'iso-8859-1': 'windows-1252',
  latin1: 'windows-1252',
};

/**
 * The encoding an XML file declares (<?xml version="1.0" encoding="windows-1252"?>), which wins
 * over guessing from the bytes. null: no declaration; 'unsupported': a name we cannot decode.
 */
export function declaredXmlEncoding(sample: Uint8Array): TextEncoding | 'unsupported' | null {
  const head = Buffer.from(sample.subarray(0, 200)).toString('latin1');
  const name = /^\s*<\?xml[^>]*\bencoding\s*=\s*["']([^"']+)["']/i.exec(head)?.[1];
  if (!name) return null;
  if (/^utf-?16/i.test(name)) return null; // decided by the byte-order mark
  return ALIASES[name.toLowerCase()] ?? 'unsupported';
}

/**
 * Streams an XML export with one record per child of the root element:
 * `<register><record SN="1"><NAAM>…</NAAM>…</record>…</register>`. A record's attributes and
 * child elements become its columns. The parser never loads external entities or DTDs.
 */
export class XmlConnector implements SourceConnector {
  constructor(
    private readonly bytes: Readable,
    private readonly encoding: TextEncoding,
  ) {}

  async *read(): AsyncIterable<RawRow> {
    const decoder = new TextDecoder(this.encoding);
    const parser = new SaxesParser();
    const ready: RawRow[] = [];
    let error: Error | undefined;
    let depth = 0;
    let rowNo = 0;
    let record: Record<string, string> | null = null;
    let field: string | null = null;
    let text = '';

    parser.on('error', (err) => {
      error ??= new SourceFormatError(`Malformed XML: ${err.message}`);
    });
    parser.on('opentag', (tag) => {
      depth += 1;
      if (depth === 2) {
        record = {};
        for (const [name, value] of Object.entries(tag.attributes)) record[name] = String(value);
      } else if (depth === 3) {
        field = tag.name;
        text = '';
      }
    });
    const onText = (t: string) => {
      if (depth >= 3) text += t; // deeper elements contribute their text to the column
    };
    parser.on('text', onText);
    parser.on('cdata', onText);
    parser.on('closetag', () => {
      if (depth === 3 && record && field !== null) {
        record[field] = text;
        field = null;
      } else if (depth === 2 && record) {
        rowNo += 1;
        ready.push({ rowNo, values: record });
        record = null;
      }
      depth -= 1;
    });

    try {
      for await (const chunk of this.bytes) {
        parser.write(decoder.decode(chunk as Buffer, { stream: true }));
        if (error) throw error;
        yield* ready.splice(0);
      }
      parser.write(decoder.decode());
      parser.close();
      if (error) throw error;
      yield* ready.splice(0);
    } finally {
      this.bytes.destroy(); // also when the reader stops early (a 50-row preview)
    }
  }
}
