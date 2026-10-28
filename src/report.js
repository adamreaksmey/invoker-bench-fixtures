const DECIMAL_PLACES = 2;
const ROUNDING_FACTOR = 10 ** DECIMAL_PLACES;

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
