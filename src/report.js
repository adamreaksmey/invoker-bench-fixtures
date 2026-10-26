export function groupRows(rows, groupColumn, sumColumn) {
  const totals = new Map();
  for (const row of rows) {
    const key = row[groupColumn];
    totals.set(key, (totals.get(key) ?? 0) + Number(row[sumColumn]));
  }
  return [...totals].map(([key, total]) => ({ [groupColumn]: key, [`sum_${sumColumn}`]: total }));
}

export function formatTable(rows) {
  if (rows.length === 0) return "";
  const columns = Object.keys(rows[0]);
  const widths = columns.map((column) => Math.max(column.length, ...rows.map((row) => String(row[column]).length)));
  const formatLine = (cells) => cells.map((cell, index) => String(cell).padEnd(widths[index])).join("  ").trimEnd();
  return [formatLine(columns), ...rows.map((row) => formatLine(columns.map((column) => row[column])))].join("\n") + "\n";
}
