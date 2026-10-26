export function groupRows(rows, groupColumn, sumColumn, count = false) {
  const totals = new Map();
  for (const row of rows) {
    const key = row[groupColumn];
    const current = totals.get(key) ?? { sum: 0, count: 0 };
    if (sumColumn) current.sum += Number(row[sumColumn]);
    current.count += 1;
    totals.set(key, current);
  }
  return [...totals.entries()].sort(([a], [b]) => {
    const left = String(a);
    const right = String(b);
    return left < right ? -1 : left > right ? 1 : 0;
  }).map(([key, value]) => {
    const result = { [groupColumn]: key };
    if (sumColumn) result[`sum_${sumColumn}`] = Math.round((value.sum + Number.EPSILON) * 100) / 100;
    if (count) result.count = value.count;
    return result;
  });
}

export function formatTable(rows, columns = rows.length ? Object.keys(rows[0]) : []) {
  if (columns.length === 0) return "";
  const widths = columns.map((column) => Math.max(column.length, ...rows.map((row) => String(row[column] ?? "").length)));
  const formatLine = (cells) => cells.map((cell, index) => String(cell ?? "").padEnd(widths[index])).join("  ").trimEnd();
  return [formatLine(columns), ...rows.map((row) => formatLine(columns.map((column) => row[column])))].join("\n") + "\n";
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function formatCsv(rows, columns = rows.length ? Object.keys(rows[0]) : []) {
  if (columns.length === 0) return "";
  return [columns.map(csvCell).join(","), ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(","))].join("\n") + "\n";
}

export function formatJson(rows) { return `${JSON.stringify(rows, null, 2)}\n`; }
