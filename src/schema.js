const TYPE_STRING = "string";
const TYPE_INTEGER = "integer";
const TYPE_NUMBER = "number";
const TYPE_DATE = "date";
const TYPE_BOOLEAN = "boolean";
const EMPTY_CELL = "";
const BOOLEAN_TRUE = "true";
const BOOLEAN_FALSE = "false";
const INTEGER_PATTERN = /^-?\d+$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_INDEX_OFFSET = 1;
const MESSAGE_REQUIRED = "required value missing";
const MESSAGE_INVALID_INTEGER = "invalid integer";
const MESSAGE_INVALID_NUMBER = "invalid number";
const MESSAGE_INVALID_DATE = "invalid date";
const MESSAGE_INVALID_BOOLEAN = "invalid boolean";
const MESSAGE_NOT_IN_ENUM = "not in enum";
const MESSAGE_BELOW_MIN = "below minimum";
const MESSAGE_ABOVE_MAX = "above maximum";
const MESSAGE_UNKNOWN_TYPE = "unknown type";

export function validateRows(rows, header, schema) {
  const columns = schema.columns ?? {};
  const missingColumn = findMissingColumn(header, columns);
  if (missingColumn !== undefined) {
    return emptyValidationResult(missingColumn);
  }
  return validateDataRows(rows, columns);
}

function emptyValidationResult(missingColumn) {
  return {
    missingColumn,
    rows: [],
    errors: [],
    invalidRowCount: 0,
  };
}

function validateDataRows(rows, columns) {
  const validatedRows = [];
  const errors = [];
  let invalidRowCount = 0;

  for (let index = 0; index < rows.length; index += 1) {
    const outcome = validateRow(rows[index], columns, index + 1);
    errors.push(...outcome.errors);
    if (outcome.errors.length > 0) {
      invalidRowCount += 1;
      continue;
    }
    validatedRows.push(outcome.row);
  }

  return {
    missingColumn: undefined,
    rows: validatedRows,
    errors,
    invalidRowCount,
  };
}

function findMissingColumn(header, columns) {
  const headerSet = new Set(header);
  for (const columnName of Object.keys(columns)) {
    if (!headerSet.has(columnName)) {
      return columnName;
    }
  }
  return undefined;
}

function validateRow(sourceRow, columns, rowNumber) {
  const row = { ...sourceRow };
  const errors = [];

  for (const [columnName, columnSchema] of Object.entries(columns)) {
    const cellValue = sourceRow[columnName] ?? EMPTY_CELL;
    const cellError = validateCell(cellValue, columnSchema);
    if (cellError !== undefined) {
      errors.push(formatCellError(rowNumber, columnName, cellError));
      continue;
    }
    row[columnName] = convertCell(cellValue, columnSchema.type);
  }

  return { row, errors };
}

function formatCellError(rowNumber, columnName, message) {
  return `row ${rowNumber}: ${columnName}: ${message}`;
}

function validateCell(cellValue, columnSchema) {
  const isMissing = cellValue === EMPTY_CELL;
  if (isMissing) {
    return columnSchema.required ? MESSAGE_REQUIRED : undefined;
  }

  const typeError = validateType(cellValue, columnSchema.type);
  if (typeError !== undefined) {
    return typeError;
  }

  if (columnSchema.enum !== undefined && !isAllowedEnumValue(cellValue, columnSchema.enum)) {
    return MESSAGE_NOT_IN_ENUM;
  }

  return validateBounds(cellValue, columnSchema);
}

function validateType(cellValue, typeName) {
  if (typeName === TYPE_STRING) {
    return undefined;
  }
  if (typeName === TYPE_INTEGER) {
    return INTEGER_PATTERN.test(cellValue) ? undefined : MESSAGE_INVALID_INTEGER;
  }
  if (typeName === TYPE_NUMBER) {
    return isValidNumber(cellValue) ? undefined : MESSAGE_INVALID_NUMBER;
  }
  if (typeName === TYPE_DATE) {
    return isValidDate(cellValue) ? undefined : MESSAGE_INVALID_DATE;
  }
  if (typeName === TYPE_BOOLEAN) {
    return isValidBoolean(cellValue) ? undefined : MESSAGE_INVALID_BOOLEAN;
  }
  return MESSAGE_UNKNOWN_TYPE;
}

function validateBounds(cellValue, columnSchema) {
  const appliesBounds =
    columnSchema.type === TYPE_INTEGER || columnSchema.type === TYPE_NUMBER;
  if (!appliesBounds) {
    return undefined;
  }

  const numericValue = Number(cellValue);
  if (columnSchema.min !== undefined && numericValue < columnSchema.min) {
    return MESSAGE_BELOW_MIN;
  }
  if (columnSchema.max !== undefined && numericValue > columnSchema.max) {
    return MESSAGE_ABOVE_MAX;
  }
  return undefined;
}

function isAllowedEnumValue(cellValue, allowedValues) {
  return allowedValues.some((allowed) => String(allowed) === cellValue);
}

function isValidNumber(cellValue) {
  if (cellValue.trim() === EMPTY_CELL) {
    return false;
  }
  const numericValue = Number(cellValue);
  return Number.isFinite(numericValue);
}

function isValidBoolean(cellValue) {
  return cellValue === BOOLEAN_TRUE || cellValue === BOOLEAN_FALSE;
}

function isValidDate(cellValue) {
  const match = DATE_PATTERN.exec(cellValue);
  if (match === null) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - MONTH_INDEX_OFFSET, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - MONTH_INDEX_OFFSET &&
    parsed.getUTCDate() === day
  );
}

function convertCell(cellValue, typeName) {
  if (cellValue === EMPTY_CELL) {
    return cellValue;
  }
  if (typeName === TYPE_INTEGER || typeName === TYPE_NUMBER) {
    return Number(cellValue);
  }
  return cellValue;
}
