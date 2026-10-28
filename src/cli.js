import { readFileSync } from "node:fs";
import { parseCsvWithHeader } from "./parse.js";
import { formatTable, groupRows } from "./report.js";
import { loadSchema, findMissingSchemaColumns, validateRows } from "./schema.js";

const USAGE = "usage: csvreport <input.csv> [--schema <file.json>] [--skip-invalid] [--group-by <column> --sum <column>]\n";
const EXIT_OK = 0;
const EXIT_USAGE = 1;
const EXIT_VALIDATION = 2;

function parseArguments(argv) {
  const options = { input: undefined, groupBy: undefined, sum: undefined, schema: undefined, skipInvalid: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--group-by") options.groupBy = argv[++index];
    else if (argument === "--sum") options.sum = argv[++index];
    else if (argument === "--schema") options.schema = argv[++index];
    else if (argument === "--skip-invalid") options.skipInvalid = true;
    else options.input = argument;
  }
  return options;
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

function buildReport(rows, groupBy, sumColumn) {
  return groupBy ? groupRows(rows, groupBy, sumColumn) : rows;
}

export function run(argv, io) {
  const options = parseArguments(argv);
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

    io.stdout(formatTable(buildReport(validation.validRows, options.groupBy, options.sum)));
    return EXIT_OK;
  }

  io.stdout(formatTable(buildReport(rows, options.groupBy, options.sum)));
  return EXIT_OK;
}
