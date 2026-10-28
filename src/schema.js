import { readFileSync } from "node:fs";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function loadSchema(path) {
  const text = readFileSync(path, "utf8");
  return JSON.parse(text);
}

export function findMissingSchemaColumns(schema, header) {
  const schemaColumns = Object.keys(schema.columns ?? {});
  return schemaColumns.filter((column) => !header.includes(column));
}

export function validateRows(rows, schema, header) {
  const columnSchemas = schema.columns ?? {};
  const schemaColumns = Object.keys(columnSchemas);
  const validRows = [];
  const errors = [];
  let droppedCount = 0;

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const rowNumber = rowIndex + 1;
    const rowErrors = validateRow(row, schemaColumns, columnSchemas);

    if (rowErrors.length > 0) {
      for (const { column, message } of rowErrors) {
        errors.push(`row ${rowNumber}: ${column}: ${message}`);
      }
      droppedCount += 1;
      continue;
    }

    validRows.push(convertRow(row, schemaColumns, columnSchemas));
  }

  return { validRows, errors, droppedCount };
}

function validateRow(row, schemaColumns, columnSchemas) {
  const errors = [];
  for (const column of schemaColumns) {
    const value = row[column] ?? "";
    const messages = validateCell(value, columnSchemas[column]);
    for (const message of messages) errors.push({ column, message });
  }
  return errors;
}

function validateCell(value, columnSchema) {
  if (value === "") {
    return columnSchema.required ? ["required value missing"] : [];
  }

  switch (columnSchema.type) {
    case "string": return validateString(value, columnSchema);
    case "integer": return validateInteger(value, columnSchema);
    case "number": return validateNumber(value, columnSchema);
    case "date": return validateDate(value, columnSchema);
    case "boolean": return validateBoolean(value, columnSchema);
    default: return [`unknown type '${columnSchema.type}'`];
  }
}

function validateString(value, columnSchema) {
  if (columnSchema.enum && !columnSchema.enum.includes(value)) {
    return [`value must be one of ${columnSchema.enum.join(", ")}`];
  }
  return [];
}

function validateInteger(value, columnSchema) {
  if (!/^-?\d+$/.test(value)) return ["value must be an integer"];
  return validateNumberRange(Number(value), columnSchema);
}

function validateNumber(value, columnSchema) {
  if (!/^-?\d+(\.\d+)?$/.test(value)) return ["value must be a number"];
  return validateNumberRange(Number(value), columnSchema);
}

function validateNumberRange(number, columnSchema) {
  if (columnSchema.min !== undefined && number < columnSchema.min) {
    return [`value must be at least ${columnSchema.min}`];
  }
  if (columnSchema.max !== undefined && number > columnSchema.max) {
    return [`value must be at most ${columnSchema.max}`];
  }
  return [];
}

function validateDate(value, columnSchema) {
  if (!DATE_PATTERN.test(value)) return ["value must be a date in YYYY-MM-DD format"];
  if (!isRealCalendarDate(value)) return ["value must be a real calendar date"];
  return [];
}

function isRealCalendarDate(value) {
  const [yearString, monthString, dayString] = value.split("-");
  const year = Number(yearString);
  const month = Number(monthString);
  const day = Number(dayString);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function validateBoolean(value, columnSchema) {
  if (value !== "true" && value !== "false") return ["value must be a boolean (true/false)"];
  return [];
}

function convertRow(row, schemaColumns, columnSchemas) {
  const converted = { ...row };
  for (const column of schemaColumns) {
    const value = row[column] ?? "";
    if (value === "") continue;
    converted[column] = convertValue(value, columnSchemas[column].type);
  }
  return converted;
}

function convertValue(value, type) {
  if (type === "integer" || type === "number") return Number(value);
  if (type === "boolean") return value === "true";
  return value;
}
