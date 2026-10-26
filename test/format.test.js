import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatCsv, formatJson } from "../src/report.js";
import { run } from "../src/cli.js";

const GROUP_COLUMN = "region";
const SUM_COLUMN = "amount";
const JSON_INDENT = 2;
const LINE_ENDING = "\n";

function writeTempFile(fileName, contents) {
  const directory = mkdtempSync(join(tmpdir(), "csvreport-"));
  const path = join(directory, fileName);
  writeFileSync(path, contents);
  return path;
}

function writeCsv(contents) {
  return writeTempFile("input.csv", contents);
}

function writeSchema(columns) {
  return writeTempFile("schema.json", JSON.stringify({ columns }));
}

function runCli(argv) {
  const output = { stdout: "", stderr: "" };
  const exitCode = run(argv, {
    stdout: (text) => {
      output.stdout += text;
    },
    stderr: (text) => {
      output.stderr += text;
    },
  });
  return { exitCode, ...output };
}

test("formatJson pretty-prints with 2-space indent and trailing newline", () => {
  const rows = [
    { region: "north", sum_amount: 4 },
    { region: "south", sum_amount: 2 },
  ];
  const expected = `${JSON.stringify(rows, null, JSON_INDENT)}${LINE_ENDING}`;
  assert.equal(formatJson(rows), expected);
});

test("formatJson emits numeric values as JSON numbers", () => {
  const output = formatJson([{ region: "north", sum_amount: 1.5, count: 2 }]);
  const parsed = JSON.parse(output);
  assert.equal(typeof parsed[0].sum_amount, "number");
  assert.equal(typeof parsed[0].count, "number");
  assert.equal(parsed[0].sum_amount, 1.5);
  assert.equal(parsed[0].count, 2);
});

test("formatCsv quotes only when needed and uses lf with trailing newline", () => {
  const rows = [
    { name: "plain", note: "ok" },
    { name: "has,comma", note: 'say "hi"' },
    { name: "line\nbreak", note: "ok" },
  ];
  assert.equal(
    formatCsv(rows),
    [
      "name,note",
      "plain,ok",
      '"has,comma","say ""hi"""',
      '"line\nbreak",ok',
      "",
    ].join(LINE_ENDING)
  );
});

test("cli --format json prints pretty json array", () => {
  const schemaPath = writeSchema({
    region: { type: "string", required: true },
    amount: { type: "number", required: true },
  });
  const result = runCli([
    writeCsv("region,amount\nnorth,1.5\nsouth,2\n"),
    "--schema",
    schemaPath,
    "--format",
    "json",
  ]);
  assert.equal(result.exitCode, 0);
  assert.equal(
    result.stdout,
    `${JSON.stringify(
      [
        { region: "north", amount: 1.5 },
        { region: "south", amount: 2 },
      ],
      null,
      JSON_INDENT
    )}${LINE_ENDING}`
  );
});

test("cli --format csv prints header and rows", () => {
  const result = runCli([
    writeCsv("region,amount\nnorth,1\nsouth,2\n"),
    "--group-by",
    GROUP_COLUMN,
    "--sum",
    SUM_COLUMN,
    "--format",
    "csv",
  ]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, `region,sum_amount\nnorth,1\nsouth,2\n`);
});

test("cli defaults to table format", () => {
  const result = runCli([writeCsv("name,qty\napple,2\n")]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /name\s+qty/);
  assert.match(result.stdout, /apple\s+2/);
});

test("cli --out writes file and leaves stdout empty", () => {
  const directory = mkdtempSync(join(tmpdir(), "csvreport-"));
  const outPath = join(directory, "report.json");
  const result = runCli([
    writeCsv("region,amount\nnorth,1\nsouth,2\n"),
    "--group-by",
    GROUP_COLUMN,
    "--sum",
    SUM_COLUMN,
    "--format",
    "json",
    "--out",
    outPath,
  ]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "");
  assert.equal(
    readFileSync(outPath, "utf8"),
    `${JSON.stringify(
      [
        { region: "north", sum_amount: 1 },
        { region: "south", sum_amount: 2 },
      ],
      null,
      JSON_INDENT
    )}${LINE_ENDING}`
  );
});

test("cli rejects invalid --format with exit 1", () => {
  const result = runCli([
    writeCsv("name,qty\napple,2\n"),
    "--format",
    "xml",
  ]);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /^error:/);
});
