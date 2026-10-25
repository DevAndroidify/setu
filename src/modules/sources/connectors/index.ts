import type { SourceKind } from '@prisma/client';
import { Readable } from 'node:stream';
import { CsvConnector, SourceConnector } from './csv.connector';
import type { TextEncoding } from './encoding';
import { XlsxConnector } from './xlsx.connector';
import { XmlConnector } from './xml.connector';

export { declaredXmlEncoding } from './xml.connector';

export type { RawRow, SourceConnector } from './csv.connector';

/** Picks the connector for a source's kind. Text formats are decoded with `encoding`. */
export function connectorFor(
  kind: SourceKind,
  bytes: Readable,
  encoding: TextEncoding,
): SourceConnector {
  switch (kind) {
    case 'csv':
      return new CsvConnector(bytes, encoding);
    case 'excel':
      return new XlsxConnector(bytes);
    case 'xml':
      return new XmlConnector(bytes, encoding);
    default:
      throw new Error(`No connector for ${kind} sources yet`);
  }
}

/** Formats whose files are text in some encoding (Excel workbooks are zip archives). */
export const isTextKind = (kind: SourceKind): boolean => kind !== 'excel';

/**
 * Checks a workbook by its first bytes, not its name: an .xlsx file is a zip archive. Old .xls
 * workbooks (OLE2 compound files) are not read; they must be saved again as .xlsx or CSV.
 */
export function workbookProblem(sample: Uint8Array): string | null {
  const starts = (...bytes: number[]) => bytes.every((b, i) => sample[i] === b);
  if (starts(0x50, 0x4b, 0x03, 0x04)) return null;
  if (starts(0xd0, 0xcf, 0x11, 0xe0)) {
    return 'Old .xls workbooks are not supported: save the file as .xlsx or CSV and upload it again';
  }
  return 'The file is not an Excel (.xlsx) workbook';
}
