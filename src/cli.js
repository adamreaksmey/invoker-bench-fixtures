import { readFileSync } from "node:fs";
import { parseCsvDocument } from "./parse.js";
import { formatTable, groupRows } from "./report.js";
import { validateRows } from "./schema.js";

const USAGE = "usage: csvreport <input.csv> [--group-by <column> [--sum <column>] [--count]]\n";
const EXIT_OK = 0;
const EXIT_USAGE = 1;

function parseArguments(argv) {
  const options = { input: undefined, groupBy: undefined, sum: undefined, count: false, schema: undefined, skipInvalid: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--group-by") options.groupBy = argv[++index];
    else if (argument === "--sum") options.sum = argv[++index];
    else if (argument === "--count") options.count = true;
    else if (argument === "--schema") options.schema = argv[++index];
    else if (argument === "--skip-invalid") options.skipInvalid = true;
    else options.input = argument;
  }
  return options;
}

export function run(argv, io) {
  const options = parseArguments(argv);
  if (!options.input) {
    io.stderr(USAGE);
    return EXIT_USAGE;
  }
  const document = parseCsvDocument(readFileSync(options.input, "utf8"));
  let rows = document.rows;
  if (options.schema) {
    let schema;
    try {
      schema = JSON.parse(readFileSync(options.schema, "utf8"));
    } catch (error) {
      io.stderr(`error: could not read schema: ${error.message}\n`);
      return EXIT_USAGE;
    }
    const validation = validateRows(rows, document.header, schema);
    if (validation.missingColumns?.length) {
      for (const column of validation.missingColumns) io.stderr(`error: missing column ${column}\n`);
      return 2;
    }
    for (const error of validation.errors) io.stderr(`row ${error.row}: ${error.column}: ${error.message}\n`);
    if (validation.errors.length && !options.skipInvalid) return 2;
    rows = validation.rows;
    if (validation.errors.length && options.skipInvalid) {
      const count = new Set(validation.errors.map((error) => error.row)).size;
      io.stderr(`skipped ${count} invalid row(s)\n`);
    }
  }
  const report = options.groupBy ? groupRows(rows, options.groupBy, options.sum, options.count) : rows;
  io.stdout(formatTable(report));
  return EXIT_OK;
}
