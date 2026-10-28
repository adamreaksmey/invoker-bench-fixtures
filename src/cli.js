import { readFileSync } from "node:fs";
import { parseCsvTable } from "./parse.js";
import { findMissingSchemaColumns, readSchema, validateRows } from "./schema.js";
import { formatTable, groupRows } from "./report.js";

const USAGE = "usage: csvreport <input.csv> [--schema <file.json>] [--skip-invalid]\n";
const EXIT_OK = 0;
const EXIT_USAGE = 1;
const EXIT_VALIDATION = 2;
const ERROR_PREFIX = "error: ";
const MISSING_COLUMN_LABEL = "missing column ";
const SKIPPED_LABEL = "skipped ";
const SKIPPED_SUFFIX = " invalid row(s)\n";

const OPTION_HANDLERS = new Map([
  ["--group-by", (options, value) => { options.groupBy = value; }],
  ["--sum", (options, value) => { options.sum = value; }],
  ["--schema", (options, value) => { options.schema = value; }],
  ["--skip-invalid", (options) => { options.skipInvalid = true; }],
]);

function parseArguments(argv) {
  const options = { input: undefined, groupBy: undefined, sum: undefined, schema: undefined, skipInvalid: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const handler = OPTION_HANDLERS.get(argument);
    if (handler === undefined) options.input = argument;
    else if (argument === "--skip-invalid") handler(options);
    else handler(options, argv[++index]);
  }
  return options;
}

export function run(argv, io) {
  const options = parseArguments(argv);
  if (!options.input) {
    io.stderr(USAGE);
    return EXIT_USAGE;
  }
  const loadedSchema = loadSchema(options.schema, io);
  if (loadedSchema.error) return EXIT_USAGE;
  const parsedReport = buildReport(options, loadedSchema.columns);
  if (parsedReport.exitCode !== EXIT_OK) {
    io.stderr(parsedReport.stderr);
    return parsedReport.exitCode;
  }
  io.stdout(formatTable(parsedReport.report));
  if (parsedReport.stderr) io.stderr(parsedReport.stderr);
  return EXIT_OK;
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
  return options.groupBy ? groupRows(rows, options.groupBy, options.sum) : rows;
}

function renderCellError(cellError) {
  return `row ${cellError.row}: ${cellError.column}: ${cellError.message}\n`;
}

function failure(exitCode, stderr) {
  return { exitCode, stderr, report: [] };
}
