import { readFileSync, writeFileSync } from "node:fs";
import { parseCsv } from "./parse.js";
import { validateRows } from "./validate.js";
import { aggregateRows, formatOutput } from "./report.js";

const USAGE_MESSAGE = "usage: csvreport <input.csv> [options]\n";
const EXIT_OK = 0;
const EXIT_USAGE = 1;
const EXIT_VALIDATION = 2;

const VALID_FORMATS = new Set(["table", "csv", "json"]);
const FLAG_ARGUMENTS = new Set(["--group-by", "--sum", "--format", "--out", "--schema"]);

function parseArguments(argv) {
  const options = {
    input: undefined,
    groupBy: undefined,
    sum: undefined,
    count: false,
    format: "table",
    out: undefined,
    schema: undefined,
    skipInvalid: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (FLAG_ARGUMENTS.has(argument)) {
      const nextArgument = argv[index + 1];
      if (nextArgument === undefined || nextArgument.startsWith("--")) {
        throw new Error(`usage: ${argument} requires a value`);
      }
      assignFlagValue(options, argument, nextArgument);
      index += 1;
    } else if (argument === "--count") {
      options.count = true;
    } else if (argument === "--skip-invalid") {
      options.skipInvalid = true;
    } else if (argument.startsWith("--")) {
      throw new Error(`error: unknown flag ${argument}`);
    } else if (options.input === undefined) {
      options.input = argument;
    } else {
      throw new Error("usage: too many positional arguments");
    }
  }

  return options;
}

function assignFlagValue(options, flag, value) {
  if (flag === "--group-by") {
    options.groupBy = value;
  } else if (flag === "--sum") {
    options.sum = value;
  } else if (flag === "--format") {
    if (!VALID_FORMATS.has(value)) {
      throw new Error(`error: unknown format "${value}"`);
    }
    options.format = value;
  } else if (flag === "--out") {
    options.out = value;
  } else if (flag === "--schema") {
    options.schema = value;
  }
}

function readInputFile(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    throw new Error(`error: ${error.message}`);
  }
}

function readSchemaFile(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`error: ${error.message}`);
  }
}

function recordsToRows(header, records) {
  return records.map((record) =>
    Object.fromEntries(header.map((column, index) => [column, record[index] ?? ""]))
  );
}

function writeOutput(output, path, io) {
  if (path) {
    writeFileSync(path, output);
  } else {
    io.stdout(output);
  }
}

export function run(argv, io) {
  let options;
  try {
    options = parseArguments(argv);
  } catch (error) {
    io.stderr(error.message + "\n");
    return EXIT_USAGE;
  }

  if (!options.input) {
    io.stderr(USAGE_MESSAGE);
    return EXIT_USAGE;
  }

  let fileContents;
  let schema;

  try {
    fileContents = readInputFile(options.input);
    if (options.schema) {
      schema = readSchemaFile(options.schema);
    }
  } catch (error) {
    io.stderr(error.message + "\n");
    return EXIT_USAGE;
  }

  const records = parseCsv(fileContents);

  if (records.length === 0) {
    writeOutput("", options.out, io);
    return EXIT_OK;
  }

  const [header, ...dataRecords] = records;
  let rows;

  if (schema) {
    const errors = [];
    const { success, validRows, invalidCount, missingColumn } = validateRows(
      header,
      dataRecords,
      schema,
      (message) => errors.push(message)
    );

    for (const error of errors) {
      io.stderr(error + "\n");
    }

    if (missingColumn) {
      return EXIT_VALIDATION;
    }

    if (invalidCount > 0) {
      if (options.skipInvalid) {
        io.stderr(`skipped ${invalidCount} invalid row(s)\n`);
        rows = validRows;
      } else {
        return EXIT_VALIDATION;
      }
    } else {
      rows = validRows;
    }
  } else {
    rows = recordsToRows(header, dataRecords);
  }

  const report = options.groupBy
    ? aggregateRows(rows, options.groupBy, options.sum, options.count)
    : rows;

  let output;
  try {
    output = formatOutput(report, options.format);
  } catch (error) {
    io.stderr(`error: ${error.message}\n`);
    return EXIT_USAGE;
  }

  try {
    writeOutput(output, options.out, io);
  } catch (error) {
    io.stderr(`error: ${error.message}\n`);
    return EXIT_USAGE;
  }

  return EXIT_OK;
}
