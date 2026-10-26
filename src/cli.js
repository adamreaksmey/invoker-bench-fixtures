import { readFileSync } from "node:fs";
import { parseCsvWithHeader } from "./parse.js";
import { formatTable, groupRows } from "./report.js";
import { validateRows } from "./schema.js";

const USAGE = "usage: csvreport <input.csv> [--group-by <column>] [--sum <column>] [--count]\n";
const EXIT_OK = 0;
const EXIT_USAGE = 1;
const EXIT_VALIDATION = 2;

function parseArguments(argv) {
  const options = { input: undefined, groupBy: undefined, sum: undefined, schema: undefined, skipInvalid: false, count: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--group-by") options.groupBy = argv[++index];
    else if (argument === "--sum") options.sum = argv[++index];
    else if (argument === "--schema") options.schema = argv[++index];
    else if (argument === "--skip-invalid") options.skipInvalid = true;
    else if (argument === "--count") options.count = true;
    else if (argument.startsWith("--")) options.invalidArgument = argument;
    else if (!options.input) options.input = argument;
    else options.invalidArgument = argument;
  }
  return options;
}

export function run(argv, io) {
  const options = parseArguments(argv);
  if (!options.input || options.invalidArgument || (argv.includes("--group-by") && !options.groupBy)
      || (argv.includes("--sum") && !options.sum) || (argv.includes("--schema") && !options.schema)) {
    io.stderr(USAGE);
    return EXIT_USAGE;
  }
  let rows;
  let header;
  try {
    ({ rows, header } = parseCsvWithHeader(readFileSync(options.input, "utf8")));
  } catch (error) {
    io.stderr(`error: ${error.message}\n`);
    return EXIT_USAGE;
  }

  if (options.schema) {
    let schema;
    try {
      schema = JSON.parse(readFileSync(options.schema, "utf8"));
    } catch (error) {
      io.stderr(`error: ${error.message}\n`);
      return EXIT_USAGE;
    }
    const validation = validateRows(rows, header, schema);
    for (const error of validation.errors) {
      if (error.missingColumn) io.stderr(`error: missing column ${error.missingColumn}\n`);
      else io.stderr(`row ${error.row}: ${error.column}: ${error.message}\n`);
    }
    if (validation.errors.length > 0 && !options.skipInvalid) return EXIT_VALIDATION;
    if (options.skipInvalid && validation.invalidCount > 0) io.stderr(`skipped ${validation.invalidCount} invalid row(s)\n`);
    if (validation.errors.some((error) => error.missingColumn)) return EXIT_VALIDATION;
    rows = validation.rows;
  }
  const report = options.groupBy ? groupRows(rows, options.groupBy, options.sum, options.count) : rows;
  io.stdout(formatTable(report));
  return EXIT_OK;
}
