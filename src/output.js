export const DEFAULT_OUTPUT_FORMAT = "table";
export const CSV_FORMAT = "csv";
export const JSON_FORMAT = "json";

const CSV_FIELD_SEPARATOR = ",";
const CSV_QUOTE = '"';
const CSV_ESCAPED_QUOTE = '""';
const CSV_FIELD_NEEDS_QUOTING = /[",\r\n]/;
const LINE_ENDING = "\n";
const JSON_INDENT_WIDTH = 2;
const TABLE_COLUMN_SEPARATOR = "  ";
const MISSING_CELL_TEXT = "";

const FORMATTERS = new Map([
  [DEFAULT_OUTPUT_FORMAT, formatTable],
  [CSV_FORMAT, formatCsv],
  [JSON_FORMAT, formatJson],
]);

/** Renders rows in `formatName`, which must be a supported output format. */
export function formatRows(rows, formatName) {
  return FORMATTERS.get(formatName)(rows);
}

export function isSupportedOutputFormat(formatName) {
  return FORMATTERS.has(formatName);
}

/** Human-readable aligned text; exact spacing is not part of the contract. */
export function formatTable(rows) {
  if (rows.length === 0) return MISSING_CELL_TEXT;
  const columns = Object.keys(rows[0]);
  const widths = columns.map((column) => Math.max(column.length, ...rows.map((row) => cellText(row[column]).length)));
  const formatCells = (cells) => joinTableCells(cells, widths);
  const lines = [formatCells(columns), ...rows.map((row) => formatCells(columns.map((column) => row[column])))];
  return lines.join(LINE_ENDING) + LINE_ENDING;
}

/**
 * RFC 4180 CSV with `\n` line endings and a trailing newline. Only fields
 * holding a comma, quote, or line break are quoted; inner quotes are doubled.
 */
export function formatCsv(rows) {
  if (rows.length === 0) return MISSING_CELL_TEXT;
  const columns = Object.keys(rows[0]);
  const records = [columns, ...rows.map((row) => columns.map((column) => row[column]))];
  return records.map(renderCsvRecord).join(LINE_ENDING) + LINE_ENDING;
}

/** Pretty-printed JSON array with 2-space indentation and a trailing newline. */
export function formatJson(rows) {
  return JSON.stringify(rows, null, JSON_INDENT_WIDTH) + LINE_ENDING;
}

function joinTableCells(cells, widths) {
  const paddedCells = cells.map((cell, index) => cellText(cell).padEnd(widths[index]));
  return paddedCells.join(TABLE_COLUMN_SEPARATOR).trimEnd();
}

function renderCsvRecord(fields) {
  return fields.map(renderCsvField).join(CSV_FIELD_SEPARATOR);
}

function renderCsvField(field) {
  const text = cellText(field);
  if (!CSV_FIELD_NEEDS_QUOTING.test(text)) return text;
  return CSV_QUOTE + text.replaceAll(CSV_QUOTE, CSV_ESCAPED_QUOTE) + CSV_QUOTE;
}

function cellText(cell) {
  return cell === null || cell === undefined ? MISSING_CELL_TEXT : String(cell);
}
