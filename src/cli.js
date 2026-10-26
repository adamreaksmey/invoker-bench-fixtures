import { readFileSync, writeFileSync } from "node:fs";
import { parseCsvRecords, CsvParseError } from "./parse.js";
import { formatCsv, formatJson, formatTable, groupRows } from "./report.js";

const USAGE = "usage: csvreport <input.csv> [options]\n";
const EXIT_OK = 0;
const EXIT_USAGE = 1;
const EXIT_VALIDATION = 2;

function argumentError(message) { return new Error(`usage: ${message}`); }

function parseArguments(argv) {
  const options = { input: undefined, groupBy: undefined, sum: undefined, count: false, format: "table", schema: undefined, skipInvalid: false, out: undefined };
  const takesValue = new Set(["--group-by", "--sum", "--format", "--schema", "--out"]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (takesValue.has(argument)) {
      if (index + 1 >= argv.length || argv[index + 1].startsWith("--")) throw argumentError(`missing value for ${argument}`);
      const value = argv[++index];
      if (argument === "--group-by") options.groupBy = value;
      else if (argument === "--sum") options.sum = value;
      else if (argument === "--format") options.format = value;
      else if (argument === "--schema") options.schema = value;
      else options.out = value;
    } else if (argument === "--count") options.count = true;
    else if (argument === "--skip-invalid") options.skipInvalid = true;
    else if (argument.startsWith("--")) throw argumentError(`unknown option ${argument}`);
    else if (options.input) throw argumentError("only one input file is allowed");
    else options.input = argument;
  }
  if (!options.input) throw argumentError(USAGE.trim());
  if (!["table", "csv", "json"].includes(options.format)) throw argumentError(`invalid format ${options.format}`);
  return options;
}

function validateRows(rows, headers, schema, io) {
  const definitions = schema?.columns ?? {};
  for (const column of Object.keys(definitions)) if (!headers.includes(column)) {
    io.stderr(`error: missing column ${column}\n`);
    return { rows: [], invalid: true, missingColumn: true };
  }
  const validRows = [];
  let invalidCount = 0;
  rows.forEach((original, rowIndex) => {
    const row = { ...original };
    const errors = [];
    for (const [column, rule] of Object.entries(definitions)) {
      const value = row[column];
      if (value === "") {
        if (rule.required) errors.push([column, "is required"]);
        continue;
      }
      if (rule.type === "number" || rule.type === "integer") {
        const number = Number(value);
        const validNumber = value.trim() !== "" && Number.isFinite(number) && (rule.type !== "integer" || Number.isInteger(number));
        if (!validNumber) errors.push([column, rule.type === "integer" ? "must be an integer" : "must be a number"]);
        else {
          row[column] = number;
          if (rule.min !== undefined && number < rule.min) errors.push([column, `must be at least ${rule.min}`]);
          if (rule.max !== undefined && number > rule.max) errors.push([column, `must be at most ${rule.max}`]);
        }
      } else if (rule.type === "date") {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
        const date = match && new Date(`${value}T00:00:00Z`);
        if (!date || date.getUTCFullYear() !== Number(match[1]) || date.getUTCMonth() + 1 !== Number(match[2]) || date.getUTCDate() !== Number(match[3])) errors.push([column, "must be a valid date"]);
      } else if (rule.type === "boolean") {
        if (value !== "true" && value !== "false") errors.push([column, "must be true or false"]);
        else row[column] = value === "true";
      } else if (rule.type === "string" && typeof value !== "string") errors.push([column, "must be a string"]);
      if (rule.enum && !rule.enum.includes(value)) errors.push([column, `must be one of ${rule.enum.join(", ")}`]);
    }
    if (errors.length) {
      invalidCount += 1;
      for (const [column, message] of errors) io.stderr(`row ${rowIndex + 1}: ${column}: ${message}\n`);
    } else validRows.push(row);
  });
  return { rows: validRows, invalid: invalidCount > 0, invalidCount };
}

export function run(argv, io) {
  let options;
  try { options = parseArguments(argv); } catch (error) { io.stderr(`${error.message}\n`); return EXIT_USAGE; }
  let input;
  try { input = parseCsvRecords(readFileSync(options.input, "utf8")); }
  catch (error) { io.stderr(`error: ${error instanceof CsvParseError ? error.message : `cannot read ${options.input}`}\n`); return EXIT_USAGE; }
  let schema;
  if (options.schema) {
    try { schema = JSON.parse(readFileSync(options.schema, "utf8")); }
    catch { io.stderr(`error: cannot read schema ${options.schema}\n`); return EXIT_USAGE; }
  }
  const validation = validateRows(input.rows, input.headers, schema, io);
  if (validation.missingColumn) return EXIT_VALIDATION;
  if (validation.invalid && !options.skipInvalid) return EXIT_VALIDATION;
  if (validation.invalid && options.skipInvalid) io.stderr(`skipped ${validation.invalidCount} invalid row(s)\n`);
  if (options.groupBy && !input.headers.includes(options.groupBy)) { io.stderr(`error: missing column ${options.groupBy}\n`); return EXIT_USAGE; }
  if (options.sum && !input.headers.includes(options.sum)) { io.stderr(`error: missing column ${options.sum}\n`); return EXIT_USAGE; }
  const rows = options.groupBy ? groupRows(validation.rows, options.groupBy, options.sum, options.count) : validation.rows;
  const columns = options.groupBy ? [options.groupBy, ...(options.sum ? [`sum_${options.sum}`] : []), ...(options.count ? ["count"] : [])] : input.headers;
  let output;
  if (options.format === "json") output = formatJson(rows);
  else if (options.format === "csv") output = formatCsv(rows, columns);
  else output = formatTable(rows, columns);
  try { if (options.out) writeFileSync(options.out, output); else io.stdout(output); }
  catch { io.stderr("error: cannot write output\n"); return EXIT_USAGE; }
  return EXIT_OK;
}
