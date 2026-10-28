const COLUMN_TYPE_STRING = "string";
const COLUMN_TYPE_INTEGER = "integer";
const COLUMN_TYPE_NUMBER = "number";
const COLUMN_TYPE_DATE = "date";
const COLUMN_TYPE_BOOLEAN = "boolean";

const VALID_TYPES = new Set([
  COLUMN_TYPE_STRING,
  COLUMN_TYPE_INTEGER,
  COLUMN_TYPE_NUMBER,
  COLUMN_TYPE_DATE,
  COLUMN_TYPE_BOOLEAN,
]);

function isValidDateString(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() + 1 === month &&
    date.getUTCDate() === day
  );
}

function validateCell(rawValue, rule) {
  const { type, required, enum: enumValues, min, max } = rule;

  if (!VALID_TYPES.has(type)) {
    return { error: `unknown type ${type}` };
  }

  if (rawValue === "") {
    if (required) {
      return { error: "missing required value" };
    }
    return { value: null };
  }

  let typedValue;
  if (type === COLUMN_TYPE_STRING) {
    typedValue = rawValue;
  } else if (type === COLUMN_TYPE_INTEGER) {
    const numberValue = Number(rawValue);
    if (!Number.isFinite(numberValue) || !Number.isInteger(numberValue)) {
      return { error: "expected integer" };
    }
    typedValue = numberValue;
  } else if (type === COLUMN_TYPE_NUMBER) {
    const numberValue = Number(rawValue);
    if (!Number.isFinite(numberValue)) {
      return { error: "expected number" };
    }
    typedValue = numberValue;
  } else if (type === COLUMN_TYPE_DATE) {
    if (!isValidDateString(rawValue)) {
      return { error: "expected date" };
    }
    typedValue = rawValue;
  } else if (type === COLUMN_TYPE_BOOLEAN) {
    if (rawValue !== "true" && rawValue !== "false") {
      return { error: "expected boolean" };
    }
    typedValue = rawValue === "true";
  }

  if (enumValues !== undefined && !matchesEnum(typedValue, rawValue, type, enumValues)) {
    return { error: "value not in enum" };
  }

  if ((type === COLUMN_TYPE_INTEGER || type === COLUMN_TYPE_NUMBER) && min !== undefined) {
    if (typedValue < min) {
      return { error: `value below min ${min}` };
    }
  }

  if ((type === COLUMN_TYPE_INTEGER || type === COLUMN_TYPE_NUMBER) && max !== undefined) {
    if (typedValue > max) {
      return { error: `value above max ${max}` };
    }
  }

  return { value: typedValue };
}

function matchesEnum(typedValue, rawValue, type, enumValues) {
  return enumValues.some((enumValue) => {
    if (type === COLUMN_TYPE_STRING) return typedValue === String(enumValue);
    if (type === COLUMN_TYPE_INTEGER || type === COLUMN_TYPE_NUMBER) {
      return typedValue === Number(enumValue);
    }
    if (type === COLUMN_TYPE_BOOLEAN) {
      if (enumValue === true) return typedValue === true;
      if (enumValue === false) return typedValue === false;
      return rawValue === String(enumValue);
    }
    if (type === COLUMN_TYPE_DATE) {
      const enumDate = String(enumValue);
      if (!isValidDateString(enumDate)) return false;
      return typedValue === enumDate;
    }
    return false;
  });
}

export function validateRows(header, rows, schema, reportError) {
  const schemaColumns = Object.keys(schema.columns);

  for (const column of schemaColumns) {
    if (!header.includes(column)) {
      reportError(`error: missing column ${column}`);
      return { success: false, validRows: [], invalidCount: 0, missingColumn: true };
    }
  }

  const validRows = [];
  let invalidCount = 0;

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const rowNumber = rowIndex + 1;
    const rowObject = {};
    let hasError = false;

    for (const column of schemaColumns) {
      const columnIndex = header.indexOf(column);
      const rawValue = columnIndex < row.length ? row[columnIndex] : "";
      const result = validateCell(rawValue, schema.columns[column]);
      if (result.error) {
        reportError(`row ${rowNumber}: ${column}: ${result.error}`);
        hasError = true;
      } else {
        rowObject[column] = result.value;
      }
    }

    for (let columnIndex = 0; columnIndex < header.length; columnIndex += 1) {
      const column = header[columnIndex];
      if (!schemaColumns.includes(column)) {
        rowObject[column] = columnIndex < row.length ? row[columnIndex] : "";
      }
    }

    if (hasError) {
      invalidCount += 1;
    } else {
      validRows.push(rowObject);
    }
  }

  return {
    success: invalidCount === 0,
    validRows,
    invalidCount,
    missingColumn: false,
  };
}
