import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/cli.js";
import { formatCsv, formatJson, formatRows } from "../src/output.js";

const BASIC_CSV = "name,qty\napple,2\npear,5\n";
const SALES_CSV = "region,amount\nsouth,4.25\nnorth,10.50\nsouth,1.75\n";

function writeCsv(contents) {
  const path = join(mkdtempSync(join(tmpdir(), "csvreport-output-")), "input.csv");
  writeFileSync(path, contents);
  return path;
}

function temporaryPath(fileName) {
  return join(mkdtempSync(join(tmpdir(), "csvreport-out-")), fileName);
}

function writeSchema(columns) {
  const path = join(mkdtempSync(join(tmpdir(), "csvreport-output-schema-")), "schema.json");
  writeFileSync(path, JSON.stringify({ columns }));
  return path;
}

function runCli(argv) {
  const output = { stdout: "", stderr: "" };
  const exitCode = run(argv, {
    stdout: (text) => { output.stdout += text; },
    stderr: (text) => { output.stderr += text; },
  });
  return { exitCode, ...output };
}

test("table is the default format", () => {
  const result = runCli([writeCsv(BASIC_CSV)]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /^name\s+qty\n/);
});

test("json format prints a pretty array of objects with a trailing newline", () => {
  const result = runCli([writeCsv(BASIC_CSV), "--format", "json"]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, `[\n  {\n    "name": "apple",\n    "qty": "2"\n  },\n  {\n    "name": "pear",\n    "qty": "5"\n  }\n]\n`);
});

test("json format emits numeric cells as JSON numbers", () => {
  const csvPath = writeCsv("region,amount\nnorth,1.5\nnorth,2\n");
  const schemaPath = writeSchema({ region: { type: "string" }, amount: { type: "number" } });
  const result = runCli([csvPath, "--schema", schemaPath, "--format", "json"]);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(JSON.parse(result.stdout), [
    { region: "north", amount: 1.5 },
    { region: "north", amount: 2 },
  ]);
  assert.match(result.stdout, /"amount": 1\.5/);
});

test("json format emits aggregated sums and counts as JSON numbers", () => {
  const csvPath = writeCsv("region,amount\nnorth,1\nnorth,2\n");
  const schemaPath = writeSchema({ region: { type: "string" }, amount: { type: "integer" } });
  const result = runCli([csvPath, "--schema", schemaPath, "--group-by", "region", "--sum", "amount", "--count", "--format", "json"]);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(JSON.parse(result.stdout), [{ region: "north", sum_amount: 3, count: 2 }]);
});

test("json format of an empty report is an empty array", () => {
  const result = runCli([writeCsv("region,amount\n"), "--group-by", "region", "--format", "json"]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "[]\n");
});

test("csv format quotes only fields that need it", () => {
  const rows = [
    { name: "plain", note: "has,comma", quote: 'say "hi"', other: "line\nbreak" },
  ];
  assert.equal(formatCsv(rows), 'name,note,quote,other\nplain,"has,comma","say ""hi""","line\nbreak"\n');
});

test("csv format ends every line with \\n including the last one", () => {
  const result = runCli([writeCsv(BASIC_CSV), "--format", "csv"]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "name,qty\napple,2\npear,5\n");
  assert.ok(!result.stdout.includes("\r"));
});

test("csv format round-trips through the parser", () => {
  const rows = [{ name: 'a"b', note: "x,y" }];
  const rendered = formatRows(rows, "csv");
  assert.equal(rendered, 'name,note\n"a""b","x,y"\n');
});

test("--out writes the file and leaves stdout empty", () => {
  const outPath = temporaryPath("report.json");
  const result = runCli([writeCsv(BASIC_CSV), "--format", "json", "--out", outPath]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "");
  assert.equal(readFileSync(outPath, "utf8"), formatJson([{ name: "apple", qty: "2" }, { name: "pear", qty: "5" }]));
});

test("--out works with the csv format", () => {
  const outPath = temporaryPath("report.csv");
  const result = runCli([writeCsv(SALES_CSV), "--group-by", "region", "--sum", "amount", "--count", "--format", "csv", "--out", outPath]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "");
  assert.equal(readFileSync(outPath, "utf8"), "region,sum_amount,count\nnorth,10.5,1\nsouth,6,2\n");
});

test("--out reports an unwritable path as a usage error", () => {
  const result = runCli([writeCsv(BASIC_CSV), "--out", join(temporaryPath("missing"), "nested", "report.csv")]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /^error: cannot write output file /);
  assert.equal(result.stdout, "");
});

test("an unsupported format is a usage error naming the format", () => {
  const result = runCli([writeCsv(BASIC_CSV), "--format", "xml"]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /^error: unsupported --format xml/);
  assert.equal(result.stdout, "");
});

test("validation errors still exit 2 and write nothing when a format is chosen", () => {
  const csvPath = writeCsv("region,amount\nnorth,oops\n");
  const schemaPath = writeSchema({ region: { type: "string" }, amount: { type: "number" } });
  const result = runCli([csvPath, "--schema", schemaPath, "--format", "json"]);
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /^row 1: amount: expected a number/m);
});

test("formatJson keeps a trailing newline after the closing bracket", () => {
  assert.equal(formatJson([]), "[]\n");
  assert.equal(formatJson([{ a: 1 }]), '[\n  {\n    "a": 1\n  }\n]\n');
});
