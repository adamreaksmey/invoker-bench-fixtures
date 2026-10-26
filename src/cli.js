import { readFileSync, writeFileSync } from "node:fs";
import { parseCsvDocument } from "./parse.js";
import { formatRows, groupRows, isValidFormat } from "./report.js";
import { validateRows } from "./schema.js";

const USAGE =
  "usage: csvreport <input.csv> [--schema <file.json>] [--skip-invalid] [--group-by <column>] [--sum <column>] [--count] [--format table|csv|json] [--out <path>]\n";
const EXIT_OK = 0;
const EXIT_USAGE = 1;
const EXIT_VALIDATION = 2;
const DEFAULT_FORMAT = "table";
const ERROR_MISSING_COLUMN_PREFIX = "error: missing column ";
const ERROR_INVALID_FORMAT = "error: invalid --format\n";
const ERROR_UNKNOWN_FLAG_PREFIX = "error: unknown flag ";
const ERROR_IO_PREFIX = "error: ";
const SKIPPED_INVALID_SUFFIX = " invalid row(s)";
const SKIPPED_INVALID_PREFIX = "skipped ";
const FLAG_PREFIX = "--";
const VALUE_FLAGS = new Map([
  ["--group-by", "groupBy"],
  ["--sum", "sum"],
  ["--schema", "schema"],
  ["--format", "format"],
  ["--out", "out"],
]);
const BOOLEAN_FLAGS = new Map([
  ["--count", "count"],
  ["--skip-invalid", "skipInvalid"],
]);

function parseArguments(argv) {
  const options = {
    input: undefined,
    groupBy: undefined,
    sum: undefined,
    count: false,
    schema: undefined,
    skipInvalid: false,
    format: DEFAULT_FORMAT,
    out: undefined,
    error: undefined,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const consumed = applyFlag(options, argv[index], argv, index);
    if (consumed === undefined) {
      return options;
    }
    index += consumed;
  }
  return options;
}

function applyFlag(options, argument, argv, index) {
  const valueKey = VALUE_FLAGS.get(argument);
  if (valueKey !== undefined) {
    options[valueKey] = argv[index + 1];
    return 1;
  }
  const booleanKey = BOOLEAN_FLAGS.get(argument);
  if (booleanKey !== undefined) {
    options[booleanKey] = true;
    return 0;
  }
  if (argument.startsWith(FLAG_PREFIX)) {
    options.error = `${ERROR_UNKNOWN_FLAG_PREFIX}${argument}\n`;
    return undefined;
  }
  options.input = argument;
  return 0;
}

export function run(argv, io) {
  const options = parseArguments(argv);
  const usageExit = validateOptions(options, io);
  if (usageExit !== undefined) {
    return usageExit;
  }

  const document = readInputDocument(options.input, io);
  if (document === undefined) {
    return EXIT_USAGE;
  }

  const rows = applySchema(document, options, io);
  if (rows === undefined) {
    return EXIT_VALIDATION;
  }

  const report = options.groupBy
    ? groupRows(rows, options.groupBy, { sum: options.sum, count: options.count })
    : rows;
  return writeOutput(formatRows(report, options.format), options.out, io);
}

function validateOptions(options, io) {
  if (options.error !== undefined) {
    io.stderr(options.error);
    return EXIT_USAGE;
  }
  if (!options.input) {
    io.stderr(USAGE);
    return EXIT_USAGE;
  }
  if (!isValidFormat(options.format)) {
    io.stderr(ERROR_INVALID_FORMAT);
    return EXIT_USAGE;
  }
  return undefined;
}

function readInputDocument(inputPath, io) {
  try {
    return parseCsvDocument(readFileSync(inputPath, "utf8"));
  } catch (error) {
    io.stderr(`${ERROR_IO_PREFIX}${error.message}\n`);
    return undefined;
  }
}

function writeOutput(text, outPath, io) {
  if (outPath === undefined) {
    io.stdout(text);
    return EXIT_OK;
  }
  try {
    writeFileSync(outPath, text);
  } catch (error) {
    io.stderr(`${ERROR_IO_PREFIX}${error.message}\n`);
    return EXIT_USAGE;
  }
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
