const DECIMAL_PLACES = 2;
const ROUNDING_FACTOR = 10 ** DECIMAL_PLACES;
const COMMA = ",";
const QUOTE = '"';
const CARRIAGE_RETURN = "\r";
const LINE_FEED = "\n";
const CSV_LINE_SEPARATOR = "\n";

function roundToTwoDecimals(value) {
  return Math.round(value * ROUNDING_FACTOR) / ROUNDING_FACTOR;
}

function compareStringsAscending(a, b) {
  const stringA = String(a);
  const stringB = String(b);
  if (stringA < stringB) return -1;
  if (stringA > stringB) return 1;
  return 0;
}

export function groupRows(rows, groupColumn, { sumColumn, includeCount } = {}) {
  const groups = new Map();
  for (const row of rows) {
    const key = row[groupColumn];
    if (!groups.has(key)) {
      groups.set(key, { sum: 0, count: 0 });
    }
    const group = groups.get(key);
    if (sumColumn !== undefined) {
      group.sum += Number(row[sumColumn]);
    }
    group.count += 1;
  }

  const sortedKeys = [...groups.keys()].sort(compareStringsAscending);

  return sortedKeys.map((key) => {
    const group = groups.get(key);
    const result = { [groupColumn]: key };
    if (sumColumn !== undefined) {
      result[`sum_${sumColumn}`] = roundToTwoDecimals(group.sum);
    }
    if (includeCount) {
      result.count = group.count;
    }
    return result;
  });
}

export function formatTable(rows) {
  if (rows.length === 0) return "";
  const columns = Object.keys(rows[0]);
  const widths = columns.map((column) => Math.max(column.length, ...rows.map((row) => String(row[column]).length)));
  const formatLine = (cells) => cells.map((cell, index) => String(cell).padEnd(widths[index])).join("  ").trimEnd();
  return [formatLine(columns), ...rows.map((row) => formatLine(columns.map((column) => row[column])))].join("\n") + "\n";
}

function formatCsvField(value) {
  const text = String(value);
  const needsQuoting = text.includes(COMMA) || text.includes(QUOTE) || text.includes(CARRIAGE_RETURN) || text.includes(LINE_FEED);
  if (!needsQuoting) return text;
  return `${QUOTE}${text.replaceAll(QUOTE, `${QUOTE}${QUOTE}`)}${QUOTE}`;
}

export function formatCsv(rows) {
  if (rows.length === 0) return "";
  const columns = Object.keys(rows[0]);
  const formatHeader = () => columns.map((column) => formatCsvField(column)).join(COMMA);
  const formatRow = (row) => columns.map((column) => formatCsvField(row[column])).join(COMMA);
  const lines = [formatHeader(), ...rows.map(formatRow)];
  return lines.join(CSV_LINE_SEPARATOR) + CSV_LINE_SEPARATOR;
}

export function formatJson(rows) {
  return `${JSON.stringify(rows, null, 2)}\n`;
}

const FORMATTERS = {
  table: formatTable,
  csv: formatCsv,
  json: formatJson,
};

export function formatRows(rows, format) {
  const formatter = FORMATTERS[format];
  if (formatter === undefined) {
    throw new Error(`unknown format '${format}'`);
  }
  return formatter(rows);
}
