import { readFileSync, writeFileSync } from "node:fs";
import { parseCsvDocument } from "./parse.js";
import { formatCsv, formatJson, formatTable, groupRows } from "./report.js";
import { validateRows } from "./schema.js";

const USAGE = "usage: csvreport <input.csv> [--group-by <column> [--sum <column>] [--count]] [--format table|csv|json] [--out <path>]\n";
const EXIT_OK = 0;
const EXIT_USAGE = 1;

function parseArguments(argv) {
  const options = { input: undefined, groupBy: undefined, sum: undefined, count: false, schema: undefined, skipInvalid: false, format: "table", out: undefined };
  const valueFor = (argument, index) => {
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) return { error: `usage: ${argument} requires a value\n` };
    return { value };
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (["--group-by", "--sum", "--schema", "--format", "--out"].includes(argument)) {
      const parsed = valueFor(argument, index);
      if (parsed.error) return { error: parsed.error };
      index += 1;
      if (argument === "--group-by") options.groupBy = parsed.value;
      else if (argument === "--sum") options.sum = parsed.value;
      else if (argument === "--schema") options.schema = parsed.value;
      else if (argument === "--format") options.format = parsed.value;
      else options.out = parsed.value;
    }
    else if (argument === "--count") options.count = true;
    else if (argument === "--skip-invalid") options.skipInvalid = true;
    else if (argument.startsWith("--")) return { error: `error: unknown option ${argument}\n` };
    else if (options.input === undefined) options.input = argument;
    else return { error: "usage: only one input file may be specified\n" };
  }
  if (!options.input) return { error: USAGE };
  if (!["table", "csv", "json"].includes(options.format)) return { error: `usage: invalid format ${options.format}\n` };
  return { options };
}

export function run(argv, io) {
  const parsed = parseArguments(argv);
  if (parsed.error) {
    io.stderr(parsed.error);
    return EXIT_USAGE;
  }
  const options = parsed.options;
  let input;
  try {
    input = readFileSync(options.input, "utf8");
  } catch (error) {
    io.stderr(`error: ${error.message}\n`);
    return EXIT_USAGE;
  }
  let document;
  try {
    document = parseCsvDocument(input);
  } catch (error) {
    io.stderr(`error: ${error.message}\n`);
    return EXIT_USAGE;
  }
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
  const columns = options.groupBy
    ? [options.groupBy, ...(options.sum === undefined ? [] : [`sum_${options.sum}`]), ...(options.count ? ["count"] : [])]
    : document.header;
  const output = options.format === "json"
    ? formatJson(report)
    : options.format === "csv"
      ? formatCsv(report, columns)
      : formatTable(report);
  if (options.out) {
    try {
      writeFileSync(options.out, output);
    } catch (error) {
      io.stderr(`error: ${error.message}\n`);
      return EXIT_USAGE;
    }
  } else {
    io.stdout(output);
  }
  return EXIT_OK;
}
