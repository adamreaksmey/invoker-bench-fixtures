function roundToTwoDecimals(value) {
  return Math.round(value * 100) / 100;
}

function renderCell(cell) {
  if (cell === null || cell === undefined) return "";
  return String(cell);
}

export function aggregateRows(rows, groupColumn, sumColumn, includeCount) {
  const groups = new Map();

  for (const row of rows) {
    const typedKey = row[groupColumn];
    const stringKey = String(typedKey);
    if (!groups.has(stringKey)) {
      groups.set(stringKey, { typedKey, sum: 0, count: 0 });
    }
    const group = groups.get(stringKey);
    if (sumColumn !== undefined) {
      group.sum += Number(row[sumColumn]);
    }
    group.count += 1;
  }

  const sortedKeys = [...groups.keys()].sort((a, b) => a.localeCompare(b));
  const result = [];

  for (const key of sortedKeys) {
    const group = groups.get(key);
    const outputRow = { [groupColumn]: group.typedKey };
    if (sumColumn !== undefined) {
      outputRow[`sum_${sumColumn}`] = roundToTwoDecimals(group.sum);
    }
    if (includeCount) {
      outputRow.count = group.count;
    }
    result.push(outputRow);
  }

  return result;
}

export function formatTable(rows) {
  if (rows.length === 0) return "";
  const columns = Object.keys(rows[0]);
  const widths = columns.map((column) =>
    Math.max(column.length, ...rows.map((row) => renderCell(row[column]).length))
  );
  const formatLine = (cells) =>
    cells.map((cell, index) => renderCell(cell).padEnd(widths[index])).join("  ").trimEnd();
  return [formatLine(columns), ...rows.map((row) => formatLine(columns.map((column) => row[column])))].join("\n") + "\n";
}

function formatCsvField(field) {
  const text = renderCell(field);
  if (text.includes(",") || text.includes('"') || text.includes("\n") || text.includes("\r")) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function formatCsvRecord(fields) {
  return fields.map(formatCsvField).join(",");
}

export function formatCsv(rows) {
  if (rows.length === 0) return "";
  const columns = Object.keys(rows[0]);
  const lines = [formatCsvRecord(columns)];
  for (const row of rows) {
    lines.push(formatCsvRecord(columns.map((column) => row[column])));
  }
  return lines.join("\n") + "\n";
}

export function formatJson(rows) {
  return JSON.stringify(rows, null, 2) + "\n";
}

export function formatOutput(rows, format) {
  if (format === "table") return formatTable(rows);
  if (format === "csv") return formatCsv(rows);
  if (format === "json") return formatJson(rows);
  throw new Error(`unknown format ${format}`);
}
