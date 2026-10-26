export function groupRows(rows, groupColumn, sumColumn, includeCount = false) {
  const totals = new Map();
  for (const row of rows) {
    const key = row[groupColumn];
    const group = totals.get(key) ?? { key, total: 0, count: 0 };
    if (sumColumn) group.total += Number(row[sumColumn]);
    group.count += 1;
    totals.set(key, group);
  }
  return [...totals.values()]
    .sort((left, right) => String(left.key) < String(right.key) ? -1 : String(left.key) > String(right.key) ? 1 : 0)
    .map(({ key, total, count }) => {
      const result = { [groupColumn]: key };
      if (sumColumn) result[`sum_${sumColumn}`] = Math.round((total + Number.EPSILON) * 100) / 100;
      if (includeCount) result.count = count;
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

export function formatCsv(rows) {
  const columns = rows.length ? Object.keys(rows[0]) : [];
  const quote = (value) => {
    const text = String(value ?? "");
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [columns, ...rows.map((row) => columns.map((column) => row[column]))]
    .map((record) => record.map(quote).join(","))
    .join("\n") + "\n";
}

export function formatJson(rows) {
  return `${JSON.stringify(rows, null, 2)}\n`;
}
