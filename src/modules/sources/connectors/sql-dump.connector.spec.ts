import fc from 'fast-check';
import { Readable } from 'node:stream';
import { encodeCp1252, generateRegister } from '../../../../tools/generate-legacy-data';
import { toSqlDump } from '../../../../tools/legacy-formats';
import { CsvConnector, RawRow, SourceConnector } from './csv.connector';
import { SourceFormatError } from './format-error';
import { parseStatement, SqlDumpConnector, StatementSplitter } from './sql-dump.connector';

async function readAll(connector: SourceConnector): Promise<RawRow[]> {
  const rows: RawRow[] = [];
  for await (const row of connector.read()) rows.push(row);
  return rows;
}

const chunked = (bytes: Buffer, size = 7): Readable =>
  Readable.from(
    Array.from({ length: Math.ceil(bytes.length / size) }, (_, i) =>
      bytes.subarray(i * size, (i + 1) * size),
    ),
  );

const dump = (sql: string) =>
  readAll(new SqlDumpConnector(Readable.from([Buffer.from(sql)]), 'utf-8'));

describe('SqlDumpConnector', () => {
  it('reads the same rows from a SQL dump as from the CSV of the register', async () => {
    const register = generateRegister({ rows: 300, seed: 23, encoding: 'cp1252' });
    const fromCsv = await readAll(
      new CsvConnector(Readable.from([encodeCp1252(register.csv)]), 'windows-1252'),
    );
    const bytes = encodeCp1252(toSqlDump(register));
    expect(await readAll(new SqlDumpConnector(chunked(bytes), 'windows-1252'))).toEqual(fromCsv);
  });

  it('takes the columns from CREATE TABLE when an INSERT has no column list', async () => {
    const rows = await dump(
      'CREATE TABLE IF NOT EXISTS `db`.`t` (`a` int NOT NULL, `b` varchar(10), PRIMARY KEY (`a`), KEY `k` (`b`));\n' +
        "INSERT INTO `db`.`t` VALUES (1,'x'),(2,NULL);",
    );
    expect(rows).toEqual([
      { rowNo: 1, values: { a: '1', b: 'x' } },
      { rowNo: 2, values: { a: '2', b: '' } },
    ]);
  });

  it('decodes quotes, backslash escapes and N-prefixed Unicode literals', async () => {
    const rows = await dump(
      "INSERT INTO [t] ([a],[b],[c]) VALUES ('it''s','line\\nbreak; \\'quoted\\'', N'राम');",
    );
    expect(rows[0]!.values).toEqual({ a: "it's", b: "line\nbreak; 'quoted'", c: 'राम' });
  });

  it('ignores comments, SET statements and semicolons inside strings and comments', async () => {
    const rows = await dump(
      '-- dump; of a register\nSET NAMES latin1;\n/*!40101 SET @x=1; */;\n# note; here\n' +
        "INSERT INTO t (a) VALUES ('semi;colon'), (-4.5);",
    );
    expect(rows.map((r) => r.values.a)).toEqual(['semi;colon', '-4.5']);
  });

  it('reports content problems as format errors, so profiling saves them instead of retrying', async () => {
    await expect(dump("INSERT INTO t (a) VALUES ('open")).rejects.toThrow(SourceFormatError);
    await expect(dump('INSERT INTO t (a) VALUES (NOW());')).rejects.toThrow(SourceFormatError);
  });

  it('refuses a dump with rows of more than one table', async () => {
    await expect(
      dump('INSERT INTO a (x) VALUES (1); INSERT INTO b (x) VALUES (2);'),
    ).rejects.toThrow(/more than one table \(a, b\)/);
  });

  it('refuses values it would have to execute', async () => {
    await expect(dump('INSERT INTO t (a) VALUES (NOW());')).rejects.toThrow(/only literals/);
    await expect(dump('INSERT INTO t (a) SELECT x FROM y;')).rejects.toThrow(/no VALUES/);
  });

  it('closes the byte stream when the reader stops early', async () => {
    const register = generateRegister({ rows: 500, seed: 23, encoding: 'cp1252' });
    const bytes = chunked(encodeCp1252(toSqlDump(register)), 256);
    for await (const row of new SqlDumpConnector(bytes, 'windows-1252').read())
      if (row.rowNo === 10) break;
    expect(bytes.destroyed).toBe(true);
  });
});

describe('StatementSplitter', () => {
  it('splits the same way however the text is cut into chunks', () => {
    const sql =
      "/* c; */ INSERT INTO t (a) VALUES ('x;''y\\\\'); -- z;\nSET x = 1; INSERT INTO `t;` (a) VALUES (2);";
    const whole = new StatementSplitter();
    const expected = [...whole.push(sql), ...whole.end()];
    expect(expected).toHaveLength(3);
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: sql.length }), { maxLength: 10 }), (cuts) => {
        const points = [0, ...[...new Set(cuts)].sort((a, b) => a - b), sql.length];
        const splitter = new StatementSplitter();
        const out: string[] = [];
        for (let i = 1; i < points.length; i++)
          out.push(...splitter.push(sql.slice(points[i - 1], points[i])));
        out.push(...splitter.end());
        expect(out).toEqual(expected);
      }),
    );
  });

  it('fails on a dump that ends inside a string', () => {
    const splitter = new StatementSplitter();
    splitter.push("INSERT INTO t VALUES ('open");
    expect(() => splitter.end()).toThrow(/inside a quoted string/);
  });
});

describe('parseStatement', () => {
  it('ignores statements other than CREATE TABLE and INSERT', () => {
    expect(parseStatement('LOCK TABLES `t` WRITE')).toEqual({ kind: 'other' });
    expect(parseStatement('CREATE INDEX i ON t (a)')).toEqual({ kind: 'other' });
  });
});
