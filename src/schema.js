const TYPE_STRING = "string";
const TYPE_INTEGER = "integer";
const TYPE_NUMBER = "number";
const TYPE_DATE = "date";
const TYPE_BOOLEAN = "boolean";
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const BOOLEAN_TRUE = "true";
const BOOLEAN_FALSE = "false";
const MESSAGE_REQUIRED = "required value missing";
const MESSAGE_INVALID_INTEGER = "invalid integer";
const MESSAGE_INVALID_NUMBER = "invalid number";
const MESSAGE_INVALID_DATE = "invalid date";
const MESSAGE_INVALID_BOOLEAN = "invalid boolean";
const MESSAGE_ENUM = "value not in enum";
const MESSAGE_MIN = "below minimum";
const MESSAGE_MAX = "above maximum";

function isMissing(cell) {
  return cell === undefined || cell === "";
}

function parseInteger(cell) {
  if (!/^-?\d+$/.test(cell)) return { error: MESSAGE_INVALID_INTEGER };
  return { value: Number(cell) };
}

function parseNumber(cell) {
  if (!/^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(cell)) {
    return { error: MESSAGE_INVALID_NUMBER };
  }
  const value = Number(cell);
  if (!Number.isFinite(value)) return { error: MESSAGE_INVALID_NUMBER };
  return { value };
}

function parseDate(cell) {
  const match = DATE_PATTERN.exec(cell);
  if (!match) return { error: MESSAGE_INVALID_DATE };
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  const isValid =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
  if (!isValid) return { error: MESSAGE_INVALID_DATE };
  return { value: cell };
}

function parseBoolean(cell) {
  if (cell === BOOLEAN_TRUE) return { value: true };
  if (cell === BOOLEAN_FALSE) return { value: false };
  return { error: MESSAGE_INVALID_BOOLEAN };
}

function parseTypedValue(cell, type) {
  if (type === TYPE_STRING) return { value: cell };
  if (type === TYPE_INTEGER) return parseInteger(cell);
  if (type === TYPE_NUMBER) return parseNumber(cell);
  if (type === TYPE_DATE) return parseDate(cell);
  if (type === TYPE_BOOLEAN) return parseBoolean(cell);
  return { error: `unknown type ${type}` };
}

function checkEnum(cell, allowedValues) {
  if (allowedValues === undefined) return undefined;
  if (!allowedValues.includes(cell)) return MESSAGE_ENUM;
  return undefined;
}

function checkBounds(value, rule) {
  if (rule.min !== undefined && value < rule.min) return MESSAGE_MIN;
  if (rule.max !== undefined && value > rule.max) return MESSAGE_MAX;
  return undefined;
}

function validateCell(cell, rule) {
  if (isMissing(cell)) {
    if (rule.required) return { error: MESSAGE_REQUIRED };
    return { value: undefined, missing: true };
  }
  const enumError = checkEnum(cell, rule.enum);
  if (enumError) return { error: enumError };
  const parsed = parseTypedValue(cell, rule.type ?? TYPE_STRING);
  if (parsed.error) return { error: parsed.error };
  if (rule.type === TYPE_INTEGER || rule.type === TYPE_NUMBER) {
    const boundError = checkBounds(parsed.value, rule);
    if (boundError) return { error: boundError };
  }
  return { value: parsed.value };
}

function formatRowError(rowNumber, columnName, message) {
  return `row ${rowNumber}: ${columnName}: ${message}`;
}

function findMissingColumns(headerColumns, schemaColumns) {
  const headerSet = new Set(headerColumns);
  return schemaColumns.filter((columnName) => !headerSet.has(columnName));
}

function applyColumnResult(nextRow, columnName, result, rowNumber, errors) {
  if (result.error) {
    errors.push(formatRowError(rowNumber, columnName, result.error));
    return false;
  }
  nextRow[columnName] = result.missing ? "" : result.value;
  return true;
}

function validateOneRow(sourceRow, rowNumber, schemaColumns, schema, errors) {
  const nextRow = { ...sourceRow };
  let rowIsValid = true;
  for (const columnName of schemaColumns) {
    const result = validateCell(sourceRow[columnName], schema.columns[columnName]);
    const columnOk = applyColumnResult(nextRow, columnName, result, rowNumber, errors);
    if (!columnOk) rowIsValid = false;
  }
  return rowIsValid ? nextRow : undefined;
}

/**
 * Validate rows against a schema. Converts integer/number cells to numbers.
 * @returns {{ rows: object[], errors: string[], missingColumns: string[] }}
 */
export function validateRows(columns, rows, schema) {
  const schemaColumns = Object.keys(schema.columns ?? {});
  const missingColumns = findMissingColumns(columns, schemaColumns);
  if (missingColumns.length > 0) {
    return { rows: [], errors: [], missingColumns };
  }

  const validatedRows = [];
  const errors = [];
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const validated = validateOneRow(
      rows[rowIndex],
      rowIndex + 1,
      schemaColumns,
      schema,
      errors,
    );
    if (validated) validatedRows.push(validated);
  }
  return { rows: validatedRows, errors, missingColumns: [] };
}
