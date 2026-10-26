const SUM_PREFIX = "sum_";
const COUNT_COLUMN = "count";
const DECIMAL_PLACES = 2;
const DECIMAL_FACTOR = 10 ** DECIMAL_PLACES;
const JSON_INDENT_SPACES = 2;
const QUOTE = '"';
const COMMA = ",";
const NEWLINE = "\n";
const TABLE_COLUMN_GAP = "  ";

function roundToTwoDecimals(value) {
  return Math.round(value * DECIMAL_FACTOR) / DECIMAL_FACTOR;
}

function compareGroupKeys(left, right) {
  const leftKey = String(left);
  const rightKey = String(right);
  if (leftKey < rightKey) return -1;
  if (leftKey > rightKey) return 1;
  return 0;
}

function buildAggregatedRow(groupColumn, groupKey, sumColumn, total, includeCount, count) {
  const row = { [groupColumn]: groupKey };
  if (sumColumn !== undefined) row[`${SUM_PREFIX}${sumColumn}`] = roundToTwoDecimals(total);
  if (includeCount) row[COUNT_COLUMN] = count;
  return row;
}

/** Group rows by a column; optionally sum a column and/or count rows. */
export function groupRows(rows, groupColumn, sumColumn, includeCount = false) {
  const totals = new Map();
  const counts = new Map();

  for (const row of rows) {
    const key = row[groupColumn];
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (sumColumn === undefined) continue;
    const amount = Number(row[sumColumn]);
    totals.set(key, (totals.get(key) ?? 0) + amount);
  }

  const keys = [...counts.keys()].sort(compareGroupKeys);
  return keys.map((key) =>
    buildAggregatedRow(
      groupColumn,
      key,
      sumColumn,
      totals.get(key) ?? 0,
      includeCount,
      counts.get(key),
    ),
  );
}

function columnsForRows(rows) {
  if (rows.length === 0) return [];
  return Object.keys(rows[0]);
}

function cellNeedsQuotes(value) {
  return /[",\r\n]/.test(value);
}

function escapeCsvField(value) {
  const text = String(value);
  if (!cellNeedsQuotes(text)) return text;
  return QUOTE + text.replaceAll(QUOTE, QUOTE + QUOTE) + QUOTE;
}

/** Format rows as RFC 4180 CSV (quote only when needed). */
export function formatCsv(rows) {
  const columns = columnsForRows(rows);
  if (columns.length === 0) return "";
  const lines = [
    columns.map(escapeCsvField).join(COMMA),
    ...rows.map((row) => columns.map((column) => escapeCsvField(row[column] ?? "")).join(COMMA)),
  ];
  return lines.join(NEWLINE) + NEWLINE;
}

/** Format rows as pretty-printed JSON array. */
export function formatJson(rows) {
  return JSON.stringify(rows, null, JSON_INDENT_SPACES) + NEWLINE;
}

function columnWidths(columns, rows) {
  return columns.map((column) =>
    Math.max(column.length, ...rows.map((row) => String(row[column] ?? "").length)),
  );
}

function formatTableLine(cells, widths) {
  return cells
    .map((cell, index) => String(cell).padEnd(widths[index]))
    .join(TABLE_COLUMN_GAP)
    .trimEnd();
}

/** Format rows as an aligned text table. */
export function formatTable(rows) {
  const columns = columnsForRows(rows);
  if (columns.length === 0) return "";
  const widths = columnWidths(columns, rows);
  const header = formatTableLine(columns, widths);
  const body = rows.map((row) =>
    formatTableLine(columns.map((column) => row[column] ?? ""), widths),
  );
  return [header, ...body].join(NEWLINE) + NEWLINE;
}

const FORMATTERS = {
  table: formatTable,
  csv: formatCsv,
  json: formatJson,
};

/** Format rows using the named output format. */
export function formatRows(rows, formatName) {
  const formatter = FORMATTERS[formatName];
  if (!formatter) return undefined;
  return formatter(rows);
}
