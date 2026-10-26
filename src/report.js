export function groupRows(rows, groupColumn, sumColumn, includeCount = false) {
  const groups = new Map();
  for (const row of rows) {
    const key = row[groupColumn];
    const group = groups.get(key) ?? { sum: 0, count: 0 };
    if (sumColumn !== undefined) group.sum += Number(row[sumColumn]);
    group.count += 1;
    groups.set(key, group);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => {
      const leftKey = String(left);
      const rightKey = String(right);
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    })
    .map(([key, group]) => {
      const result = { [groupColumn]: key };
      if (sumColumn !== undefined) result[`sum_${sumColumn}`] = Math.round((group.sum + Number.EPSILON) * 100) / 100;
      if (includeCount) result.count = group.count;
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
