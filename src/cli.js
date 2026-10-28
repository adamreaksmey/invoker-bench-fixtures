import { readFileSync, writeFileSync } from "node:fs";
import { parseCsvTable } from "./parse.js";
import { findMissingSchemaColumns, readSchema, validateRows } from "./schema.js";
import { groupRows } from "./report.js";
import { DEFAULT_OUTPUT_FORMAT, formatRows, isSupportedOutputFormat } from "./output.js";

const LINE_ENDING = "\n";
const USAGE_PREFIX = "usage: ";
const USAGE = `${USAGE_PREFIX}csvreport <input.csv> [--schema <file.json>] [--skip-invalid] [--group-by <col> [--sum <col>] [--count]] [--format table|csv|json] [--out <path>]${LINE_ENDING}`;
const EXIT_OK = 0;
const EXIT_USAGE = 1;
const EXIT_VALIDATION = 2;
const ERROR_PREFIX = "error: ";
const MISSING_COLUMN_LABEL = "missing column ";
const SKIPPED_LABEL = "skipped ";
const SKIPPED_SUFFIX = " invalid row(s)\n";
const UNSUPPORTED_FORMAT_PREFIX = "unsupported --format ";
const UNKNOWN_OPTION_LABEL = "unknown option ";
const MISSING_VALUE_LABEL = "missing value for ";
const UNEXPECTED_ARGUMENT_LABEL = "unexpected argument ";
const OPTION_PREFIX = "-";

/** Options that consume the following argument as their value. */
const VALUE_OPTIONS = new Map([
  ["--group-by", (options, value) => { options.groupBy = value; }],
  ["--sum", (options, value) => { options.sum = value; }],
  ["--schema", (options, value) => { options.schema = value; }],
  ["--format", (options, value) => { options.format = value; }],
  ["--out", (options, value) => { options.out = value; }],
]);

/** Flags that take no value. */
const FLAG_OPTIONS = new Map([
  ["--count", (options) => { options.count = true; }],
  ["--skip-invalid", (options) => { options.skipInvalid = true; }],
]);

function createOptions() {
  return {
    input: undefined,
    groupBy: undefined,
    sum: undefined,
    schema: undefined,
    format: DEFAULT_OUTPUT_FORMAT,
    out: undefined,
    count: false,
    skipInvalid: false,
  };
}

function parseArguments(argv) {
  const options = createOptions();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const valueHandler = VALUE_OPTIONS.get(argument);
    if (valueHandler !== undefined) {
      const value = argv[index + 1];
      if (!isOptionValue(value)) return { error: `${ERROR_PREFIX}${MISSING_VALUE_LABEL}${argument}${LINE_ENDING}` };
      valueHandler(options, value);
      index += 1;
      continue;
    }
    if (FLAG_OPTIONS.has(argument)) {
      FLAG_OPTIONS.get(argument)(options);
      continue;
    }
    if (argument.startsWith(OPTION_PREFIX)) return { error: `${ERROR_PREFIX}${UNKNOWN_OPTION_LABEL}${argument}${LINE_ENDING}` };
    if (options.input !== undefined) return { error: `${ERROR_PREFIX}${UNEXPECTED_ARGUMENT_LABEL}${argument}${LINE_ENDING}` };
    options.input = argument;
  }
  return { options };
}

/** A value is present when it exists and does not look like another option. */
function isOptionValue(candidate) {
  return candidate !== undefined && !candidate.startsWith(OPTION_PREFIX);
}

export function run(argv, io) {
  const parsedArguments = parseArguments(argv);
  if (parsedArguments.error) {
    io.stderr(parsedArguments.error);
    return EXIT_USAGE;
  }
  const options = parsedArguments.options;
  if (!options.input) {
    io.stderr(USAGE);
    return EXIT_USAGE;
  }
  if (!isSupportedOutputFormat(options.format)) {
    io.stderr(`${ERROR_PREFIX}${UNSUPPORTED_FORMAT_PREFIX}${options.format}${LINE_ENDING}`);
    return EXIT_USAGE;
  }
  const loadedSchema = loadSchema(options.schema, io);
  if (loadedSchema.error) return EXIT_USAGE;
  const parsedReport = buildReport(options, loadedSchema.columns);
  if (parsedReport.exitCode !== EXIT_OK) {
    io.stderr(parsedReport.stderr);
    return parsedReport.exitCode;
  }
  const hasOutputError = emitOutput(formatRows(parsedReport.report, options.format), options.out, io);
  if (parsedReport.stderr) io.stderr(parsedReport.stderr);
  return hasOutputError ? EXIT_USAGE : EXIT_OK;
}

/** Writes the rendered output to `outPath` or stdout; returns true on I/O failure. */
function emitOutput(renderedOutput, outPath, io) {
  if (outPath === undefined) {
    io.stdout(renderedOutput);
    return false;
  }
  try {
    writeFileSync(outPath, renderedOutput);
    return false;
  } catch {
    io.stderr(`${ERROR_PREFIX}cannot write output file ${outPath}\n`);
    return true;
  }
}

/** Returns `{ columns }` on success or `{ error: true }` after reporting an I/O error. */
function loadSchema(schemaPath, io) {
  if (schemaPath === undefined) return { columns: undefined };
  try {
    return { columns: readSchema(schemaPath) };
  } catch (schemaError) {
    io.stderr(ERROR_PREFIX + schemaError.message + "\n");
    return { error: true };
  }
}

/** Returns `{ exitCode, stderr, report }` describing what the CLI should emit. */
function buildReport(options, schemaColumns) {
  let table;
  try {
    table = parseCsvTable(readFileSync(options.input, "utf8"));
  } catch {
    return failure(EXIT_USAGE, `${ERROR_PREFIX}cannot read input file ${options.input}\n`);
  }
  return schemaColumns === undefined
    ? { exitCode: EXIT_OK, stderr: "", report: aggregate(table.rows, options) }
    : validateTable(table, options, schemaColumns);
}

function validateTable(table, options, schemaColumns) {
  const missingColumns = findMissingSchemaColumns(table.header, schemaColumns);
  if (missingColumns.length > 0) {
    const report = missingColumns.map((name) => `${ERROR_PREFIX}${MISSING_COLUMN_LABEL}${name}\n`).join("");
    return failure(EXIT_VALIDATION, report);
  }
  const { errors, invalidRowCount, validRows } = validateRows(table.rows, schemaColumns);
  const renderedErrors = errors.map(renderCellError).join("");
  if (invalidRowCount > 0 && !options.skipInvalid) return failure(EXIT_VALIDATION, renderedErrors);
  const skipNotice = invalidRowCount > 0 ? `${SKIPPED_LABEL}${invalidRowCount}${SKIPPED_SUFFIX}` : "";
  return { exitCode: EXIT_OK, stderr: renderedErrors + skipNotice, report: aggregate(validRows, options) };
}

function aggregate(rows, options) {
  if (options.groupBy === undefined) return rows;
  return groupRows(rows, { groupBy: options.groupBy, sumColumn: options.sum, count: options.count });
}

function renderCellError(cellError) {
  return `row ${cellError.row}: ${cellError.column}: ${cellError.message}\n`;
}

function failure(exitCode, stderr) {
  return { exitCode, stderr, report: [] };
}
