import ExcelJS from 'exceljs';
import { Readable } from 'node:stream';
import { encodeCp1252, generateRegister } from '../../../../tools/generate-legacy-data';
import { toXlsx } from '../../../../tools/legacy-formats';
import { CsvConnector, RawRow, SourceConnector } from './csv.connector';
import { SourceFormatError } from './format-error';
import { cellText, XlsxConnector } from './xlsx.connector';

async function readAll(connector: SourceConnector): Promise<RawRow[]> {
  const rows: RawRow[] = [];
  for await (const row of connector.read()) rows.push(row);
  return rows;
}

describe('XlsxConnector', () => {
  it('reads the same rows from a workbook as from the CSV export of the same register', async () => {
    const register = generateRegister({ rows: 300, seed: 21, encoding: 'cp1252' });
    const fromCsv = await readAll(
      new CsvConnector(Readable.from([encodeCp1252(register.csv)]), 'windows-1252'),
    );
    const fromXlsx = await readAll(new XlsxConnector(Readable.from([await toXlsx(register)])));
    expect(fromXlsx).toEqual(fromCsv);
  });

  it('reads only the first worksheet and skips blank rows', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Register');
    sheet.addRow([]);
    sheet.addRow(['NAAM', 'WARD_NO']);
    sheet.addRow([';Ltf', 3]);
    sheet.addRow([]);
    sheet.addRow(['/fd', 4]);
    workbook.addWorksheet('Other').addRow(['NOT', 'DATA']);
    const bytes = Buffer.from(await workbook.xlsx.writeBuffer());

    expect(await readAll(new XlsxConnector(Readable.from([bytes])))).toEqual([
      { rowNo: 1, values: { NAAM: ';Ltf', WARD_NO: '3' } },
      { rowNo: 2, values: { NAAM: '/fd', WARD_NO: '4' } },
    ]);
  });

  it('reports a corrupt workbook as a format error', async () => {
    const corrupt = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(200, 7)]);
    await expect(readAll(new XlsxConnector(Readable.from([corrupt])))).rejects.toThrow(
      SourceFormatError,
    );
  });

  it('closes the byte stream when the reader stops early', async () => {
    const register = generateRegister({ rows: 500, seed: 21, encoding: 'cp1252' });
    const bytes = Readable.from([await toXlsx(register)]);
    for await (const row of new XlsxConnector(bytes).read()) if (row.rowNo === 10) break;
    expect(bytes.destroyed).toBe(true);
  });
});

describe('cellText', () => {
  it('writes cells as a CSV export of the sheet would', () => {
    expect(cellText(12)).toBe('12');
    expect(cellText(new Date(Date.UTC(1988, 3, 12)))).toBe('1988-04-12');
    expect(cellText({ richText: [{ text: 'Naya ' }, { text: 'Bazar' }] })).toBe('Naya Bazar');
    expect(cellText({ formula: 'A1+1', result: 7 })).toBe('7');
    expect(cellText(true)).toBe('TRUE');
    expect(cellText(null)).toBe('');
  });
});
