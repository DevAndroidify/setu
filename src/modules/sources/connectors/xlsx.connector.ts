import ExcelJS from 'exceljs';
import { Readable } from 'node:stream';
import type { RawRow, SourceConnector } from './csv.connector';
import { SourceFormatError } from './format-error';

type CellValue = ExcelJS.CellValue;

/** Excel cell values as the text a CSV export of the same sheet would hold. */
export function cellText(value: CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    // Excel stores dates without a zone; exceljs reads them as UTC.
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'object') {
    if ('richText' in value) return value.richText.map((r) => r.text).join('');
    if ('result' in value) return cellText((value.result ?? '') as CellValue); // formula
    if ('text' in value) return String(value.text); // hyperlink
    if ('error' in value) return '';
    return '';
  }
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return String(value);
}

/**
 * Streams the first worksheet of an .xlsx workbook: the first non-empty row gives the column
 * names, every later non-empty row is a data row. exceljs reads the zip as a stream, so memory
 * stays flat apart from the shared-strings table.
 */
export class XlsxConnector implements SourceConnector {
  constructor(private readonly bytes: Readable) {}

  async *read(): AsyncIterable<RawRow> {
    const workbook = new ExcelJS.stream.xlsx.WorkbookReader(this.bytes, {
      sharedStrings: 'cache',
      hyperlinks: 'cache',
      styles: 'cache', // needed to tell date cells from plain numbers
      worksheets: 'emit',
    });
    try {
      for await (const sheet of workbook) {
        let header: string[] | null = null;
        let rowNo = 0;
        for await (const row of sheet) {
          // row.values is 1-based: index 0 is always empty.
          const cells = (row.values as CellValue[]).slice(1).map(cellText);
          if (cells.every((c) => c.trim() === '')) continue;
          if (!header) {
            header = cells.map((c) => c.trim());
            continue;
          }
          rowNo += 1;
          yield {
            rowNo,
            values: Object.fromEntries(header.map((name, i) => [name, cells[i] ?? ''])),
          };
        }
        break; // first worksheet only
      }
    } catch (err) {
      // A failed download stays an infrastructure error (retried); anything else is the file.
      if (this.bytes.errored) throw err;
      throw new SourceFormatError(`Unreadable Excel workbook: ${(err as Error).message}`);
    } finally {
      // Other sheets, or the reader stopping early (a 50-row preview): close the download.
      this.bytes.destroy();
    }
  }
}
