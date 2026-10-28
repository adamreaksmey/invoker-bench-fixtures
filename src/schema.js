import { readFileSync } from "node:fs";

const MISSING_VALUE = "";
const MISSING_REQUIRED_MESSAGE = "required value is missing";
const INTEGER_MESSAGE = "expected an integer";
const NUMBER_MESSAGE = "expected a number";
const DATE_MESSAGE = "expected a date (YYYY-MM-DD)";
const BOOLEAN_MESSAGE = "expected true or false";
const ENUM_PREFIX = "expected one of: ";
const ENUM_SEPARATOR = ", ";
const MIN_PREFIX = "must be at least ";
const MAX_PREFIX = "must be at most ";

const INTEGER_PATTERN = /^[+-]?\d+$/;
const NUMBER_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const BOOLEAN_VALUES = new Set(["true", "false"]);

const VALUE_PARSERS = new Map([
  ["string", (text) => ({ value: text })],
  ["integer", (text) => (INTEGER_PATTERN.test(text) ? { value: Number(text) } : { error: INTEGER_MESSAGE })],
  ["number", (text) => (NUMBER_PATTERN.test(text) ? { value: Number(text) } : { error: NUMBER_MESSAGE })],
  ["date", (text) => (isCalendarDate(text) ? { value: text } : { error: DATE_MESSAGE })],
  ["boolean", (text) => (BOOLEAN_VALUES.has(text) ? { value: text } : { error: BOOLEAN_MESSAGE })],
]);

/**
 * Reads a schema JSON file and returns its column definitions.
 * Throws an Error carrying a user-facing message when the file cannot be read
 * or does not describe a valid schema.
 */
export function readSchema(schemaPath) {
  let rawText;
  try {
    rawText = readFileSync(schemaPath, "utf8");
  } catch {
    throw new Error(`cannot read schema file ${schemaPath}`);
  }
  return parseSchemaDocument(rawText);
}

function parseSchemaDocument(rawText) {
  let document;
  try {
    document = JSON.parse(rawText);
  } catch {
    throw new Error("schema file is not valid JSON");
  }
  const columns = document?.columns;
  if (!isPlainObject(columns)) throw new Error("schema must contain a columns object");
  for (const [name, definition] of Object.entries(columns)) assertColumnDefinition(name, definition);
  return columns;
}

function assertColumnDefinition(name, definition) {
  if (!isPlainObject(definition)) throw new Error(`schema column ${name} must be an object`);
  if (!VALUE_PARSERS.has(definition.type)) {
    throw new Error(`schema column ${name} has unsupported type ${definition.type}`);
  }
}

/** Returns the schema column names that the CSV header does not provide. */
export function findMissingSchemaColumns(header, columns) {
  const headerColumns = new Set(header);
  return Object.keys(columns).filter((name) => !headerColumns.has(name));
}

/**
 * Validates every row against the schema. Valid rows are returned with their
 * `integer` / `number` cells converted to numbers; invalid rows are excluded
 * from `validRows` and reported as cell errors with 1-based data row numbers.
 */
export function validateRows(rows, columns) {
  const rowResults = rows.map((row, index) => validateRow(row, index + 1, columns));
  return {
    errors: rowResults.flatMap((result) => result.errors),
    invalidRowCount: rowResults.filter((result) => result.errors.length > 0).length,
    validRows: rowResults.filter((result) => result.errors.length === 0).map((result) => result.row),
  };
}

function validateRow(row, rowNumber, columns) {
  const errors = [];
  const convertedRow = { ...row };
  for (const [column, definition] of Object.entries(columns)) {
    const outcome = validateCell(row[column] ?? MISSING_VALUE, definition);
    if (outcome.error) errors.push({ row: rowNumber, column, message: outcome.error });
    else if (outcome.value !== undefined) convertedRow[column] = outcome.value;
  }
  return { row: convertedRow, errors };
}

function validateCell(rawValue, definition) {
  if (rawValue === MISSING_VALUE) return missingValueOutcome(definition);
  const parsed = VALUE_PARSERS.get(definition.type)(rawValue);
  if (parsed.error) return parsed;
  const constraintError = checkConstraints(parsed.value, definition);
  return constraintError === undefined ? parsed : { error: constraintError };
}

function missingValueOutcome(definition) {
  return definition.required ? { error: MISSING_REQUIRED_MESSAGE } : {};
}

function checkConstraints(value, definition) {
  return enumError(value, definition.enum) ?? rangeError(value, definition);
}

function enumError(value, allowedValues) {
  if (!Array.isArray(allowedValues)) return undefined;
  if (allowedValues.some((allowed) => String(allowed) === String(value))) return undefined;
  return `${ENUM_PREFIX}${allowedValues.map(String).join(ENUM_SEPARATOR)}`;
}

function rangeError(value, definition) {
  if (typeof value !== "number") return undefined;
  if (isNumber(definition.min) && value < definition.min) return `${MIN_PREFIX}${definition.min}`;
  if (isNumber(definition.max) && value > definition.max) return `${MAX_PREFIX}${definition.max}`;
  return undefined;
}

function isCalendarDate(text) {
  const match = DATE_PATTERN.exec(text);
  if (match === null) return false;
  const [, year, month, day] = match.map(Number);
  if (month < 1 || month > 12) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isNumber(candidate) {
  return typeof candidate === "number" && Number.isFinite(candidate);
}

function isPlainObject(candidate) {
  return typeof candidate === "object" && candidate !== null && !Array.isArray(candidate);
}
