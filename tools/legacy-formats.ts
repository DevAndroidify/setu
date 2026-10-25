/**
 * Writes a generated register in the other legacy formats Setu reads: an Excel workbook, an
 * XML export and a SQL dump. Same rows as the CSV, so tests can compare what each connector
 * reads with what the CSV connector reads.
 */
import ExcelJS from 'exceljs';
import type { GeneratedRegister } from './generate-legacy-data';

/** Columns an Excel user would have typed as numbers, so the workbook holds numeric cells. */
const NUMERIC = new Set(['SN', 'GHAR_NO']);

export async function toXlsx(register: GeneratedRegister): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Register');
  sheet.addRow(register.header);
  for (const row of register.rows) {
    sheet.addRow(
      row.map((value, i) =>
        NUMERIC.has(register.header[i]!) && /^\d+$/.test(value) ? Number(value) : value,
      ),
    );
  }
  workbook.addWorksheet('Notes').addRow(['Exported from the ward register (synthetic)']);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

const xmlEscape = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * One <record> per row under a <register> root, the serial number as an attribute and every
 * other column as a child element, like typical .NET-era exports. The declaration names the
 * encoding the text is written in.
 */
export function toXml(register: GeneratedRegister, encoding: 'windows-1252' | 'utf-8'): string {
  const [snColumn, ...columns] = register.header;
  const records = register.rows.map((row) => {
    const [sn, ...values] = row;
    const fields = values.map((v, i) => `    <${columns[i]}>${xmlEscape(v)}</${columns[i]}>`);
    return `  <record ${snColumn}="${xmlEscape(sn!)}">\r\n${fields.join('\r\n')}\r\n  </record>`;
  });
  return (
    `<?xml version="1.0" encoding="${encoding}"?>\r\n` +
    `<!-- Ward household register, synthetic -->\r\n` +
    `<register>\r\n${records.join('\r\n')}\r\n</register>\r\n`
  );
}

const sqlString = (s: string): string => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;

/** A mysqldump-style export: CREATE TABLE, then extended INSERTs of 100 rows each. */
export function toSqlDump(register: GeneratedRegister): string {
  const columns = register.header.map((c) => `\`${c}\``);
  const create =
    `CREATE TABLE \`ghar_register\` (\n` +
    register.header.map((c) => `  \`${c}\` varchar(255) DEFAULT NULL`).join(',\n') +
    `,\n  PRIMARY KEY (\`SN\`)\n);\n`;
  const inserts: string[] = [];
  for (let i = 0; i < register.rows.length; i += 100) {
    const tuples = register.rows
      .slice(i, i + 100)
      .map((row) => `(${row.map((v) => (v === '' ? 'NULL' : sqlString(v))).join(',')})`);
    inserts.push(
      `INSERT INTO \`ghar_register\` (${columns.join(',')}) VALUES ${tuples.join(',\n')};`,
    );
  }
  return (
    `-- Dump of the ward household register (synthetic)\n` +
    `SET NAMES latin1;\n/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;\n\n` +
    `${create}\n${inserts.join('\n')}\n`
  );
}
