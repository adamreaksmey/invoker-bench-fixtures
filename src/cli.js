import { readFileSync } from "node:fs";
import { parseCsvDocument } from "./parse.js";
import { formatTable, groupRows } from "./report.js";
import { validateRows } from "./schema.js";

const USAGE =
  "usage: csvreport <input.csv> [--schema <file.json>] [--skip-invalid] [--group-by <column>] [--sum <column>] [--count]\n";
const EXIT_OK = 0;
const EXIT_USAGE = 1;
const EXIT_VALIDATION = 2;
const ERROR_MISSING_COLUMN_PREFIX = "error: missing column ";
const SKIPPED_INVALID_SUFFIX = " invalid row(s)";
const SKIPPED_INVALID_PREFIX = "skipped ";

function parseArguments(argv) {
  const options = {
    input: undefined,
    groupBy: undefined,
    sum: undefined,
    count: false,
    schema: undefined,
    skipInvalid: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--group-by") {
      options.groupBy = argv[++index];
    } else if (argument === "--sum") {
      options.sum = argv[++index];
    } else if (argument === "--count") {
      options.count = true;
    } else if (argument === "--schema") {
      options.schema = argv[++index];
    } else if (argument === "--skip-invalid") {
      options.skipInvalid = true;
    } else {
      options.input = argument;
    }
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
  const rows = applySchema(document, options, io);
  if (rows === undefined) {
    return EXIT_VALIDATION;
  }

  const report = options.groupBy
    ? groupRows(rows, options.groupBy, { sum: options.sum, count: options.count })
    : rows;
  io.stdout(formatTable(report));
  return EXIT_OK;
}

function applySchema(document, options, io) {
  if (!options.schema) {
    return document.rows;
  }

  const schema = JSON.parse(readFileSync(options.schema, "utf8"));
  const result = validateRows(document.rows, document.header, schema);

  if (result.missingColumn !== undefined) {
    io.stderr(`${ERROR_MISSING_COLUMN_PREFIX}${result.missingColumn}\n`);
    return undefined;
  }

  for (const error of result.errors) {
    io.stderr(`${error}\n`);
  }

  if (result.invalidRowCount === 0) {
    return result.rows;
  }

  if (!options.skipInvalid) {
    return undefined;
  }

  io.stderr(
    `${SKIPPED_INVALID_PREFIX}${result.invalidRowCount}${SKIPPED_INVALID_SUFFIX}\n`
  );
  return result.rows;
}
