const SUM_DECIMALS = 2;
const SUM_ROUNDING_FACTOR = 10 ** SUM_DECIMALS;
const SUM_COLUMN_PREFIX = "sum_";
const COUNT_COLUMN = "count";
const MISSING_GROUP_KEY = "";
const EMPTY_TOTAL = 0;
const EMPTY_ROW_COUNT = 0;

/**
 * Groups rows by one column. Result rows carry the group column first, then
 * `sum_<column>` when `sumColumn` is given, then `count` when `count` is set.
 * Groups are sorted by key ascending using string comparison. Sum cells that
 * are not finite numbers contribute 0, so files read without a schema total
 * instead of producing NaN.
 */
export function groupRows(rows, { groupBy, sumColumn, count }) {
  return [...accumulateGroups(rows, groupBy, sumColumn).values()]
    .sort(compareGroupKeys)
    .map((group) => toGroupRow(group, groupBy, sumColumn, count));
}

function accumulateGroups(rows, groupBy, sumColumn) {
  const groups = new Map();
  for (const row of rows) {
    const key = String(row[groupBy] ?? MISSING_GROUP_KEY);
    const group = groups.get(key) ?? createGroup(key);
    group.rowCount += 1;
    if (sumColumn !== undefined) group.total += toFiniteNumber(row[sumColumn]);
    groups.set(key, group);
  }
  return groups;
}

function createGroup(key) {
  return { key, rowCount: EMPTY_ROW_COUNT, total: EMPTY_TOTAL };
}

function compareGroupKeys(leftGroup, rightGroup) {
  if (leftGroup.key < rightGroup.key) return -1;
  return leftGroup.key > rightGroup.key ? 1 : 0;
}

function toGroupRow(group, groupBy, sumColumn, count) {
  const entries = [[groupBy, group.key]];
  if (sumColumn !== undefined) entries.push([`${SUM_COLUMN_PREFIX}${sumColumn}`, roundTotal(group.total)]);
  if (count) entries.push([COUNT_COLUMN, group.rowCount]);
  return Object.fromEntries(entries);
}

function roundTotal(total) {
  return Math.round(total * SUM_ROUNDING_FACTOR) / SUM_ROUNDING_FACTOR;
}

function toFiniteNumber(cellValue) {
  const numericValue = Number(cellValue);
  return Number.isFinite(numericValue) ? numericValue : EMPTY_TOTAL;
}
