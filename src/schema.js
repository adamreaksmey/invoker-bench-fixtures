function isNumberText(value) {
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value);
}

function isRealDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function invalidMessage(value, rule) {
  if (value === "") return rule.required ? "is required" : null;

  switch (rule.type) {
    case "integer":
      if (!isNumberText(value) || !Number.isInteger(Number(value))) return "must be an integer";
      break;
    case "number":
      if (!isNumberText(value) || !Number.isFinite(Number(value))) return "must be a number";
      break;
    case "date":
      if (!isRealDate(value)) return "must be a valid date (YYYY-MM-DD)";
      break;
    case "boolean":
      if (value !== "true" && value !== "false") return "must be true or false";
      break;
    case "string":
      break;
    default:
      return `has unsupported type ${rule.type}`;
  }

  if (Array.isArray(rule.enum) && !rule.enum.some((allowed) => allowed === value)) {
    return `must be one of: ${rule.enum.join(", ")}`;
  }

  if (rule.type === "integer" || rule.type === "number") {
    const number = Number(value);
    if (rule.min !== undefined && number < rule.min) return `must be at least ${rule.min}`;
    if (rule.max !== undefined && number > rule.max) return `must be at most ${rule.max}`;
  }

  return null;
}

function convertedValue(value, rule) {
  if (value !== "" && (rule.type === "integer" || rule.type === "number")) return Number(value);
  return value;
}

export function validateRows(rows, header, schema) {
  const columns = schema?.columns ?? {};
  const errors = [];
  const missingColumns = Object.keys(columns).filter((column) => !header.includes(column));
  for (const column of missingColumns) errors.push({ missingColumn: column });
  if (missingColumns.length > 0) return { rows: [], errors, invalidCount: 0 };

  const validRows = [];
  rows.forEach((row, rowIndex) => {
    const output = { ...row };
    let invalid = false;
    for (const [column, rule] of Object.entries(columns)) {
      const value = row[column] ?? "";
      const message = invalidMessage(value, rule);
      if (message) {
        errors.push({ row: rowIndex + 1, column, message });
        invalid = true;
      } else {
        output[column] = convertedValue(value, rule);
      }
    }
    if (!invalid) validRows.push(output);
  });

  return { rows: validRows, errors, invalidCount: rows.length - validRows.length };
}
