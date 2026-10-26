import { readFileSync } from "node:fs";
import { parseCsv } from "./parse.js";
import { formatTable, groupRows } from "./report.js";

const USAGE = "usage: csvreport <input.csv> [--group-by <column> --sum <column>]\n";
const EXIT_OK = 0;
const EXIT_USAGE = 1;

function parseArguments(argv) {
  const options = { input: undefined, groupBy: undefined, sum: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--group-by") options.groupBy = argv[++index];
    else if (argument === "--sum") options.sum = argv[++index];
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
  const rows = parseCsv(readFileSync(options.input, "utf8"));
  const report = options.groupBy ? groupRows(rows, options.groupBy, options.sum) : rows;
  io.stdout(formatTable(report));
  return EXIT_OK;
}
