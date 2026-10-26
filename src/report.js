const SUM_COLUMN_PREFIX = "sum_";
const COUNT_COLUMN = "count";
const SUM_DECIMAL_PLACES = 2;
const DECIMAL_SCALE = 10 ** SUM_DECIMAL_PLACES;
const INITIAL_SUM = 0;
const INITIAL_COUNT = 0;
const COUNT_STEP = 1;

export function groupRows(rows, groupColumn, options = {}) {
  const aggregates = buildAggregates(rows, groupColumn, options.sum);
  const sortedKeys = [...aggregates.keys()].sort(compareAscending);
  return sortedKeys.map((key) =>
    buildAggregateRow(key, aggregates.get(key), groupColumn, options)
  );
}

function buildAggregates(rows, groupColumn, sumColumn) {
  const aggregates = new Map();
  for (const row of rows) {
    const key = row[groupColumn];
    const current = aggregates.get(key) ?? {
      sum: INITIAL_SUM,
      count: INITIAL_COUNT,
    };
    current.count += COUNT_STEP;
    if (sumColumn !== undefined) {
      current.sum += Number(row[sumColumn]);
    }
    aggregates.set(key, current);
  }
  return aggregates;
}

function buildAggregateRow(key, aggregate, groupColumn, options) {
  const row = { [groupColumn]: key };
  if (options.sum !== undefined) {
    row[`${SUM_COLUMN_PREFIX}${options.sum}`] = roundSum(aggregate.sum);
  }
  if (options.count) {
    row[COUNT_COLUMN] = aggregate.count;
  }
  return row;
}

function roundSum(value) {
  return Math.round(value * DECIMAL_SCALE) / DECIMAL_SCALE;
}

function compareAscending(left, right) {
  const leftKey = String(left);
  const rightKey = String(right);
  if (leftKey < rightKey) {
    return -1;
  }
  if (leftKey > rightKey) {
    return 1;
  }
  return 0;
}

export function formatTable(rows) {
  if (rows.length === 0) {
    return "";
  }
  const columns = Object.keys(rows[0]);
  const widths = columns.map((column) =>
    Math.max(column.length, ...rows.map((row) => String(row[column]).length))
  );
  const formatLine = (cells) =>
    cells.map((cell, index) => String(cell).padEnd(widths[index])).join("  ").trimEnd();
  return (
    [formatLine(columns), ...rows.map((row) => formatLine(columns.map((column) => row[column])))].join(
      "\n"
    ) + "\n"
  );
}
