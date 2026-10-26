import { readFileSync, writeFileSync } from "node:fs";
import { parseCsv } from "./parse.js";
import { validateRows } from "./schema.js";
import { formatRows, groupRows } from "./report.js";

const USAGE =
  "usage: csvreport <input.csv> [--schema <file.json>] [--skip-invalid] " +
  "[--group-by <column>] [--sum <column>] [--count] " +
  "[--format table|csv|json] [--out <path>]\n";
const EXIT_OK = 0;
const EXIT_USAGE = 1;
const EXIT_VALIDATION = 2;
const DEFAULT_FORMAT = "table";
const ALLOWED_FORMATS = new Set(["table", "csv", "json"]);
const ERROR_PREFIX = "error: ";
const SKIPPED_SUFFIX = " invalid row(s)";

function failUsage(io, message = USAGE) {
  io.stderr(message);
  return EXIT_USAGE;
}

function failError(io, message) {
  io.stderr(ERROR_PREFIX + message + "\n");
  return EXIT_USAGE;
}

function readRequiredOption(argv, index, flagName) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    return { error: `missing value for ${flagName}` };
  }
  return { value, nextIndex: index + 1 };
}

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
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) {
      if (options.input !== undefined) return { error: `unexpected argument ${argument}` };
      options.input = argument;
      continue;
    }
    const parsed = applyFlag(options, argv, index, argument);
    if (parsed.error) return parsed;
    index = parsed.nextIndex ?? index;
  }
  return { options };
}

const VALUE_FLAGS = {
  "--group-by": "groupBy",
  "--sum": "sum",
  "--schema": "schema",
  "--format": "format",
  "--out": "out",
};
const BOOLEAN_FLAGS = {
  "--count": "count",
  "--skip-invalid": "skipInvalid",
};

function applyValueFlag(options, argv, index, argument) {
  const optionKey = VALUE_FLAGS[argument];
  if (optionKey === undefined) return undefined;
  const result = readRequiredOption(argv, index, argument);
  if (result.error) return result;
  options[optionKey] = result.value;
  return { nextIndex: result.nextIndex };
}

function applyFlag(options, argv, index, argument) {
  const valueFlag = applyValueFlag(options, argv, index, argument);
  if (valueFlag !== undefined) return valueFlag;
  const booleanKey = BOOLEAN_FLAGS[argument];
  if (booleanKey !== undefined) {
    options[booleanKey] = true;
    return {};
  }
  return { error: `unknown flag ${argument}` };
}

function readTextFile(path) {
  try {
    return { text: readFileSync(path, "utf8") };
  } catch {
    return { error: `cannot read file ${path}` };
  }
}

function writeOutput(io, options, text) {
  if (options.out === undefined) {
    io.stdout(text);
    return EXIT_OK;
  }
  try {
    writeFileSync(options.out, text, "utf8");
    return EXIT_OK;
  } catch {
    return failError(io, `cannot write file ${options.out}`);
  }
}

function loadSchema(schemaPath) {
  const file = readTextFile(schemaPath);
  if (file.error) return file;
  try {
    return { schema: JSON.parse(file.text) };
  } catch {
    return { error: `invalid schema JSON in ${schemaPath}` };
  }
}

function applySchema(io, columns, rows, options) {
  const loaded = loadSchema(options.schema);
  if (loaded.error) return { exitCode: failError(io, loaded.error) };

  const result = validateRows(columns, rows, loaded.schema);
  if (result.missingColumns.length > 0) {
    for (const columnName of result.missingColumns) {
      io.stderr(`${ERROR_PREFIX}missing column ${columnName}\n`);
    }
    return { exitCode: EXIT_VALIDATION };
  }

  for (const message of result.errors) io.stderr(message + "\n");

  if (result.errors.length === 0) return { rows: result.rows };
  if (!options.skipInvalid) return { exitCode: EXIT_VALIDATION };

  io.stderr(`skipped ${countInvalidRows(result.errors)}${SKIPPED_SUFFIX}\n`);
  return { rows: result.rows };
}

function countInvalidRows(errorLines) {
  const rowNumbers = new Set();
  for (const line of errorLines) {
    const match = /^row (\d+):/.exec(line);
    if (match) rowNumbers.add(match[1]);
  }
  return rowNumbers.size;
}

function buildReport(rows, options) {
  if (!options.groupBy) return rows;
  return groupRows(rows, options.groupBy, options.sum, options.count);
}

function loadCsv(path) {
  const inputFile = readTextFile(path);
  if (inputFile.error) return inputFile;
  try {
    return parseCsv(inputFile.text);
  } catch (parseError) {
    return { error: parseError.message };
  }
}

export function run(argv, io) {
  const parsed = parseArguments(argv);
  if (parsed.error) return failError(io, parsed.error);

  const { options } = parsed;
  if (!options.input) return failUsage(io);
  if (!ALLOWED_FORMATS.has(options.format)) {
    return failError(io, `invalid format ${options.format}`);
  }

  const loaded = loadCsv(options.input);
  if (loaded.error) return failError(io, loaded.error);

  let { rows } = loaded;
  if (options.schema) {
    const validated = applySchema(io, loaded.columns, rows, options);
    if (validated.exitCode !== undefined) return validated.exitCode;
    rows = validated.rows;
  }

  return writeOutput(io, options, formatRows(buildReport(rows, options), options.format));
}
