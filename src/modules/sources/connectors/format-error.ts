/**
 * The file's content cannot be read as its format (malformed XML, a dump with two tables, a
 * corrupt workbook). A data problem: retrying will not help, so callers report it instead.
 */
export class SourceFormatError extends Error {
  override name = 'SourceFormatError';
}
