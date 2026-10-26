const TYPES = new Set(["string", "integer", "number", "date", "boolean"]);

function isRealDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function typeError(value, type) {
  if (type === "string") return null;
  if (type === "integer") return Number.isInteger(Number(value)) && value.trim() !== "" ? null : "expected integer";
  if (type === "number") return Number.isFinite(Number(value)) && value.trim() !== "" ? null : "expected number";
  if (type === "date") return isRealDate(value) ? null : "expected date (YYYY-MM-DD)";
  if (type === "boolean") return value === "true" || value === "false" ? null : "expected boolean";
  return `unknown type ${type}`;
}

function convertedValue(value, type) {
  if (type === "integer" || type === "number") return Number(value);
  return value;
}

function validateCell(value, rule) {
  if (value === "") return rule.required ? "required" : null;
  if (!TYPES.has(rule.type)) return `unknown type ${rule.type}`;

  const typeMessage = typeError(value, rule.type);
  if (typeMessage) return typeMessage;

  const converted = convertedValue(value, rule.type);
  if (rule.enum && !rule.enum.some((allowed) => Object.is(allowed, converted))) {
    return `must be one of ${rule.enum.join(", ")}`;
  }
  if ((rule.type === "integer" || rule.type === "number") && rule.min !== undefined && converted < rule.min) {
    return `must be at least ${rule.min}`;
  }
  if ((rule.type === "integer" || rule.type === "number") && rule.max !== undefined && converted > rule.max) {
    return `must be at most ${rule.max}`;
  }
  return null;
}

export function validateRows(rows, header, schema) {
  const columns = schema?.columns ?? {};
  const missingColumns = Object.keys(columns).filter((column) => !header.includes(column));
  if (missingColumns.length > 0) return { missingColumns };

  const errors = [];
  const validRows = [];
  for (const [rowIndex, row] of rows.entries()) {
    let invalid = false;
    const convertedRow = { ...row };
    for (const [column, rule] of Object.entries(columns)) {
      const message = validateCell(row[column] ?? "", rule);
      if (message) {
        invalid = true;
        errors.push({ row: rowIndex + 1, column, message });
      } else if (row[column] !== "" && (rule.type === "integer" || rule.type === "number")) {
        convertedRow[column] = convertedValue(row[column], rule.type);
      }
    }
    if (!invalid) validRows.push(convertedRow);
  }
  return { errors, rows: validRows };
}
