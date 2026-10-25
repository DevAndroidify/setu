import { Readable } from 'node:stream';
import type { RawRow, SourceConnector } from './csv.connector';
import type { TextEncoding } from './encoding';
import { SourceFormatError } from './format-error';

/**
 * Cuts SQL text into statements at semicolons that are outside strings, quoted names and
 * comments. Fed chunk by chunk; comments are dropped (MySQL's executable comments, such as
 * `/*!40101 SET ... *\/`, too: nothing in a dump is ever executed).
 */
export class StatementSplitter {
  private current = '';
  private state: 'code' | 'quote' | 'line-comment' | 'block-comment' = 'code';
  private quote = '';
  private escaped = false;
  private pending = ''; // a character held back until the next one is known

  push(chunk: string): string[] {
    const statements: string[] = [];
    const text = this.pending + chunk;
    this.pending = '';
    for (let i = 0; i < text.length; i++) {
      const c = text[i]!;
      const next = text[i + 1];
      if (this.state === 'code' && next === undefined && (c === '-' || c === '/')) {
        this.pending = c; // could start "--" or "/*"
        break;
      }
      if (this.state === 'block-comment' && next === undefined && c === '*') {
        this.pending = c;
        break;
      }
      switch (this.state) {
        case 'code':
          if (c === "'" || c === '"' || c === '`' || c === '[') {
            this.state = 'quote';
            this.quote = c === '[' ? ']' : c;
            this.current += c;
          } else if ((c === '-' && next === '-') || c === '#') {
            this.state = 'line-comment';
          } else if (c === '/' && next === '*') {
            this.state = 'block-comment';
            i += 1;
          } else if (c === ';') {
            if (this.current.trim()) statements.push(this.current.trim());
            this.current = '';
          } else {
            this.current += c;
          }
          break;
        case 'quote':
          this.current += c;
          if (this.escaped) this.escaped = false;
          else if (c === '\\' && this.quote === "'") this.escaped = true;
          else if (c === this.quote) this.state = 'code'; // '' re-enters on the next quote
          break;
        case 'line-comment':
          if (c === '\n') {
            this.state = 'code';
            this.current += ' ';
          }
          break;
        case 'block-comment':
          if (c === '*' && next === '/') {
            this.state = 'code';
            this.current += ' ';
            i += 1;
          }
          break;
      }
    }
    return statements;
  }

  end(): string[] {
    const statements = this.push('\n');
    if (this.state === 'quote') throw new SourceFormatError('The dump ends inside a quoted string');
    if (this.current.trim()) statements.push(this.current.trim());
    this.current = '';
    return statements;
  }
}

type Token =
  | { type: 'word' | 'ident' | 'number' | 'punct'; value: string }
  | { type: 'string'; value: string };

const ESCAPES: Record<string, string> = { n: '\n', r: '\r', t: '\t', '0': '\0', Z: '\x1a' };

/** Tokens of one statement: words, quoted names, string and number literals, punctuation. */
export function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < sql.length) {
    const c = sql[i]!;
    if (/\s/.test(c)) {
      i += 1;
    } else if (c === "'") {
      let value = '';
      i += 1;
      for (;;) {
        if (i >= sql.length) throw new SourceFormatError('Unterminated string in the dump');
        const s = sql[i]!;
        if (s === '\\') {
          const e = sql[i + 1] ?? '';
          value += ESCAPES[e] ?? e;
          i += 2;
        } else if (s === "'" && sql[i + 1] === "'") {
          value += "'";
          i += 2;
        } else if (s === "'") {
          i += 1;
          break;
        } else {
          value += s;
          i += 1;
        }
      }
      // N'...' (SQL Server Unicode literal): the N was read as a word just before.
      const last = tokens[tokens.length - 1];
      if (last?.type === 'word' && last.value.toUpperCase() === 'N') tokens.pop();
      tokens.push({ type: 'string', value });
    } else if (c === '`' || c === '"' || c === '[') {
      const close = c === '[' ? ']' : c;
      const end = sql.indexOf(close, i + 1);
      if (end < 0) throw new SourceFormatError('Unterminated quoted name in the dump');
      tokens.push({ type: 'ident', value: sql.slice(i + 1, end) });
      i = end + 1;
    } else if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(sql[i + 1] ?? ''))) {
      const m = /^[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?/.exec(sql.slice(i))!;
      tokens.push({ type: 'number', value: m[0] });
      i += m[0].length;
    } else if (/[A-Za-z_@$]/.test(c)) {
      const m = /^[A-Za-z0-9_@$]+/.exec(sql.slice(i))!;
      tokens.push({ type: 'word', value: m[0] });
      i += m[0].length;
    } else {
      tokens.push({ type: 'punct', value: c });
      i += 1;
    }
  }
  return tokens;
}

const CONSTRAINTS = new Set([
  'PRIMARY',
  'KEY',
  'UNIQUE',
  'CONSTRAINT',
  'INDEX',
  'FOREIGN',
  'CHECK',
  'FULLTEXT',
  'SPATIAL',
]);

type Statement =
  | { kind: 'create'; table: string; columns: string[] }
  | { kind: 'insert'; table: string; columns: string[] | null; rows: string[][] }
  | { kind: 'other' };

class Cursor {
  private i = 0;
  constructor(private readonly tokens: Token[]) {}
  peek(): Token | undefined {
    return this.tokens[this.i];
  }
  next(): Token {
    const t = this.tokens[this.i++];
    if (!t) throw new SourceFormatError('Unexpected end of a statement in the dump');
    return t;
  }
  isWord(...words: string[]): boolean {
    const t = this.peek();
    return t?.type === 'word' && words.includes(t.value.toUpperCase());
  }
  isPunct(p: string): boolean {
    const t = this.peek();
    return t?.type === 'punct' && t.value === p;
  }
  expectPunct(p: string): void {
    const t = this.next();
    if (t.type !== 'punct' || t.value !== p)
      throw new SourceFormatError(`Expected "${p}" in the dump`);
  }
  /** A possibly qualified name (db.schema.table): the last part. */
  name(): string {
    let t = this.next();
    while (this.isPunct('.')) {
      this.next();
      t = this.next();
    }
    if (t.type !== 'word' && t.type !== 'ident')
      throw new SourceFormatError('Expected a name in the dump');
    return t.value;
  }
}

/** A literal in a VALUES tuple, as the text a CSV export would hold (NULL is empty). */
function literal(cur: Cursor): string {
  const t = cur.next();
  if (t.type === 'string' || t.type === 'number') return t.value;
  if (t.type === 'punct' && (t.value === '-' || t.value === '+')) {
    const n = cur.next();
    if (n.type !== 'number') throw new SourceFormatError('Expected a number in the dump');
    return t.value === '-' ? `-${n.value}` : n.value;
  }
  if (t.type === 'word') {
    const w = t.value.toUpperCase();
    if (w === 'NULL') return '';
    if (w === 'TRUE' || w === 'FALSE') return w;
  }
  throw new SourceFormatError(
    `Unsupported value "${t.value}" in an INSERT: only literals are read`,
  );
}

/** Recognizes CREATE TABLE and INSERT statements; everything else is ignored. */
export function parseStatement(sql: string): Statement {
  const cur = new Cursor(tokenize(sql));
  if (cur.isWord('CREATE')) {
    cur.next();
    if (!cur.isWord('TABLE')) return { kind: 'other' };
    cur.next();
    if (cur.isWord('IF')) {
      cur.next(); // IF NOT EXISTS
      cur.next();
      cur.next();
    }
    const table = cur.name();
    cur.expectPunct('(');
    const columns: string[] = [];
    let depth = 0;
    let atStart = true;
    while (cur.peek()) {
      const t = cur.next();
      if (t.type === 'punct' && t.value === '(') depth += 1;
      else if (t.type === 'punct' && t.value === ')') {
        if (depth === 0) break;
        depth -= 1;
      } else if (t.type === 'punct' && t.value === ',' && depth === 0) {
        atStart = true;
        continue;
      } else if (atStart && (t.type === 'ident' || t.type === 'word')) {
        if (!(t.type === 'word' && CONSTRAINTS.has(t.value.toUpperCase()))) columns.push(t.value);
      }
      atStart = false;
    }
    return { kind: 'create', table, columns };
  }
  if (cur.isWord('INSERT', 'REPLACE')) {
    cur.next();
    while (cur.isWord('IGNORE', 'LOW_PRIORITY', 'DELAYED', 'HIGH_PRIORITY')) cur.next();
    if (cur.isWord('INTO')) cur.next();
    const table = cur.name();
    let columns: string[] | null = null;
    if (cur.isPunct('(')) {
      cur.next();
      columns = [];
      while (!cur.isPunct(')')) {
        columns.push(cur.name());
        if (cur.isPunct(',')) cur.next();
      }
      cur.next();
    }
    if (!cur.isWord('VALUES', 'VALUE')) {
      throw new SourceFormatError(`INSERT into ${table} has no VALUES: only literal rows are read`);
    }
    cur.next();
    const rows: string[][] = [];
    for (;;) {
      cur.expectPunct('(');
      const row: string[] = [];
      while (!cur.isPunct(')')) {
        row.push(literal(cur));
        if (cur.isPunct(',')) cur.next();
      }
      cur.next();
      rows.push(row);
      if (!cur.isPunct(',')) break;
      cur.next();
    }
    return { kind: 'insert', table, columns, rows };
  }
  return { kind: 'other' };
}

/**
 * Reads the rows of one table from a SQL dump (CREATE TABLE plus INSERT statements, as
 * mysqldump and similar tools write them). Statements are parsed, never executed. Column
 * names come from each INSERT's column list, or from the table's CREATE TABLE.
 */
export class SqlDumpConnector implements SourceConnector {
  constructor(
    private readonly bytes: Readable,
    private readonly encoding: TextEncoding,
  ) {}

  async *read(): AsyncIterable<RawRow> {
    const decoder = new TextDecoder(this.encoding);
    const splitter = new StatementSplitter();
    const created = new Map<string, string[]>();
    let table: string | null = null;
    let rowNo = 0;

    const rowsOf = function* (sql: string): Generator<RawRow> {
      const statement = parseStatement(sql);
      if (statement.kind === 'create') created.set(statement.table, statement.columns);
      if (statement.kind !== 'insert') return;
      table ??= statement.table;
      if (statement.table !== table) {
        throw new SourceFormatError(
          `The dump holds rows of more than one table (${table}, ${statement.table}): export one table per file`,
        );
      }
      const columns = statement.columns ?? created.get(statement.table);
      if (!columns) {
        throw new SourceFormatError(
          `INSERT into ${statement.table} names no columns and the dump has no CREATE TABLE for it`,
        );
      }
      for (const row of statement.rows) {
        rowNo += 1;
        yield { rowNo, values: Object.fromEntries(columns.map((c, i) => [c, row[i] ?? ''])) };
      }
    };

    try {
      for await (const chunk of this.bytes) {
        for (const sql of splitter.push(decoder.decode(chunk as Buffer, { stream: true }))) {
          yield* rowsOf(sql);
        }
      }
      for (const sql of splitter.push(decoder.decode())) yield* rowsOf(sql);
      for (const sql of splitter.end()) yield* rowsOf(sql);
    } finally {
      this.bytes.destroy(); // also when the reader stops early (a 50-row preview)
    }
  }
}
