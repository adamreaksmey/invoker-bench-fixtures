import { readFileSync, writeFileSync } from "node:fs";
import { parseCsvWithHeader } from "./parse.js";
import { formatRows, groupRows } from "./report.js";
import { loadSchema, findMissingSchemaColumns, validateRows } from "./schema.js";

const USAGE = "usage: csvreport <input.csv> [--schema <file.json>] [--skip-invalid] [--group-by <column> [--sum <column>] [--count]] [--format table|csv|json] [--out <path>]\n";
const VALID_FORMATS = ["table", "csv", "json"];
const EXIT_OK = 0;
const EXIT_USAGE = 1;
const EXIT_VALIDATION = 2;

function readOptionValue(argv, index) {
  const value = argv[index + 1];
  if (value === undefined) return { ok: false };
  return { ok: true, value, nextIndex: index + 2 };
}

function parseArguments(argv) {
  const options = {
    input: undefined,
    groupBy: undefined,
    sum: undefined,
    count: false,
    schema: undefined,
    skipInvalid: false,
    format: "table",
    out: undefined,
  };
  let index = 0;
  while (index < argv.length) {
    const argument = argv[index];
    if (["--group-by", "--sum", "--schema", "--format", "--out"].includes(argument)) {
      const result = readOptionValue(argv, index);
      if (!result.ok) return { error: USAGE };
      if (argument === "--group-by") options.groupBy = result.value;
      else if (argument === "--sum") options.sum = result.value;
      else if (argument === "--schema") options.schema = result.value;
      else if (argument === "--format") options.format = result.value;
      else if (argument === "--out") options.out = result.value;
      index = result.nextIndex;
      continue;
    }
    if (argument === "--count") options.count = true;
    else if (argument === "--skip-invalid") options.skipInvalid = true;
    else if (argument.startsWith("--")) return { error: USAGE };
    else options.input = argument;
    index += 1;
  }
  if (!VALID_FORMATS.includes(options.format)) return { error: USAGE };
  return { options };
}

function readInput(io, path) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    io.stderr(`error: ${error.message}\n`);
    return undefined;
  }
}

function readSchema(io, path) {
  try {
    return loadSchema(path);
  } catch (error) {
    io.stderr(`error: ${error.message}\n`);
    return undefined;
  }
}

function reportMissingColumns(io, columns) {
  for (const column of columns) io.stderr(`error: missing column ${column}\n`);
}

function reportValidationErrors(io, errors) {
  for (const error of errors) io.stderr(`${error}\n`);
}

function buildReport(rows, groupBy, sumColumn, includeCount) {
  return groupBy ? groupRows(rows, groupBy, { sumColumn, includeCount }) : rows;
}

function writeReport(io, rows, options) {
  const output = formatRows(rows, options.format);
  if (options.out) {
    try {
      writeFileSync(options.out, output);
      return EXIT_OK;
    } catch (error) {
      io.stderr(`error: ${error.message}\n`);
      return EXIT_USAGE;
    }
  }
  io.stdout(output);
  return EXIT_OK;
}

export function run(argv, io) {
  const parsed = parseArguments(argv);
  if (parsed.error) {
    io.stderr(parsed.error);
    return EXIT_USAGE;
  }
  const options = parsed.options;
  if (!options.input) {
    io.stderr(USAGE);
    return EXIT_USAGE;
  }

  const text = readInput(io, options.input);
  if (text === undefined) return EXIT_USAGE;

  const { header, rows } = parseCsvWithHeader(text);

  if (options.schema) {
    const schema = readSchema(io, options.schema);
    if (schema === undefined) return EXIT_USAGE;

    const missingColumns = findMissingSchemaColumns(schema, header);
    if (missingColumns.length > 0) {
      reportMissingColumns(io, missingColumns);
      return EXIT_VALIDATION;
    }

    const validation = validateRows(rows, schema, header);
    reportValidationErrors(io, validation.errors);

    if (validation.errors.length > 0) {
      if (!options.skipInvalid) return EXIT_VALIDATION;
      io.stderr(`skipped ${validation.droppedCount} invalid row(s)\n`);
    }

    return writeReport(io, buildReport(validation.validRows, options.groupBy, options.sum, options.count), options);
  }

  return writeReport(io, buildReport(rows, options.groupBy, options.sum, options.count), options);
}
