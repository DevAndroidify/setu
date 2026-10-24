import { parse } from 'csv-parse';
import { Readable } from 'node:stream';
import type { TextEncoding } from './encoding';

/** One data row of a legacy file: its 1-based row number and values by column name. */
export type RawRow = { rowNo: number; values: Record<string, string> };

/** Every source connector exposes its rows the same way, one at a time. */
export interface SourceConnector {
  read(): AsyncIterable<RawRow>;
}

/**
 * Streams a CSV file: decodes bytes in the given encoding, uses the first row as column names,
 * and yields one row at a time so memory stays flat regardless of file size.
 */
export class CsvConnector implements SourceConnector {
  constructor(
    private readonly bytes: Readable,
    private readonly encoding: TextEncoding,
  ) {}

  async *read(): AsyncIterable<RawRow> {
    const decoder = new TextDecoder(this.encoding); // drops a byte-order mark if present
    const parser = parse({
      columns: (header: string[]) => header.map((name) => name.trim()),
      relax_column_count: true, // legacy rows are often short or long; profiling reports it
      skip_empty_lines: true,
      bom: false,
    });

    const feed = (async () => {
      for await (const chunk of this.bytes) {
        if (!parser.write(decoder.decode(chunk as Buffer, { stream: true }))) {
          await new Promise((resolve) => parser.once('drain', resolve));
        }
      }
      parser.end(decoder.decode());
    })();
    feed.catch((err: Error) => parser.destroy(err));

    let rowNo = 0;
    for await (const record of parser) {
      rowNo += 1;
      yield { rowNo, values: record as Record<string, string> };
    }
    await feed;
  }
}
