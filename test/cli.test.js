import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/cli.js";

function makeTempDir() {
  return mkdtempSync(join(tmpdir(), "csvreport-"));
}

function writeCsv(contents) {
  const path = join(makeTempDir(), "input.csv");
  writeFileSync(path, contents);
  return path;
}

function writeSchema(contents) {
  const path = join(makeTempDir(), "schema.json");
  writeFileSync(path, JSON.stringify(contents));
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

test("prints rows as a table", () => {
  const result = runCli([writeCsv("name,qty\napple,2\npear,5\n")]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /apple\s+2/);
  assert.match(result.stdout, /pear\s+5/);
});

test("groups and sums a column", () => {
  const result = runCli([writeCsv("region,amount\nnorth,1\nsouth,2\nnorth,3\n"), "--group-by", "region", "--sum", "amount"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /north\s+4/);
  assert.match(result.stdout, /south\s+2/);
});

test("prints usage without an input file", () => {
  const result = runCli([]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /^usage:/);
});

test("errors reading a missing input file", () => {
  const result = runCli(["/does/not/exist.csv"]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /^error:/);
});

test("errors reading a non-file input path", () => {
  const tempDir = makeTempDir();
  const result = runCli([tempDir]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /^error:/);
});

test("validates rows against a schema", () => {
  const schema = {
    columns: {
      region: { type: "string", required: true, enum: ["north", "south"] },
      amount: { type: "number", required: true, min: 0 },
      qty: { type: "integer" },
      day: { type: "date" },
      paid: { type: "boolean" },
    },
  };
  const result = runCli([
    writeCsv("region,amount,qty,day,paid\nnorth,10.50,2,2026-01-03,true\nsouth,4.25,1,2026-01-03,false\n"),
    "--schema",
    writeSchema(schema),
  ]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /north\s+10\.5/);
  assert.match(result.stdout, /south\s+4\.25/);
});

test("reports invalid cells to stderr and exits 2", () => {
  const schema = { columns: { qty: { type: "integer", required: true } } };
  const result = runCli([
    writeCsv("qty\n1\nnot-a-number\n3\n"),
    "--schema",
    writeSchema(schema),
  ]);
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /row 2: qty: value must be an integer/);
});

test("reports missing required values", () => {
  const schema = { columns: { region: { type: "string", required: true } } };
  const result = runCli([
    writeCsv("region\nnorth\n\n"),
    "--schema",
    writeSchema(schema),
  ]);
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /row 2: region: required value missing/);
});

test("reports missing schema columns", () => {
  const schema = { columns: { missing: { type: "string" } } };
  const result = runCli([
    writeCsv("region\nnorth\n"),
    "--schema",
    writeSchema(schema),
  ]);
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /error: missing column missing/);
});

test("skip-invalid drops invalid rows and prints skipped count", () => {
  const schema = { columns: { qty: { type: "integer" } } };
  const result = runCli([
    writeCsv("qty\n1\nbad\n3\n"),
    "--schema",
    writeSchema(schema),
    "--skip-invalid",
  ]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /1/);
  assert.match(result.stdout, /3/);
  assert.equal(result.stdout.includes("bad"), false);
  assert.match(result.stderr, /row 2: qty: value must be an integer/);
  assert.match(result.stderr, /skipped 1 invalid row\(s\)/);
});

test("converts integer and number columns before aggregation", () => {
  const schema = { columns: { region: { type: "string" }, amount: { type: "number" } } };
  const result = runCli([
    writeCsv("region,amount\nnorth,1.5\nnorth,2.5\n"),
    "--schema",
    writeSchema(schema),
    "--group-by",
    "region",
    "--sum",
    "amount",
  ]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /4/);
});

test("counts rows per group with --count", () => {
  const result = runCli([
    writeCsv("region,amount\nnorth,1\nsouth,2\nnorth,3\n"),
    "--group-by",
    "region",
    "--count",
  ]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /north\s+2/);
  assert.match(result.stdout, /south\s+1/);
});

test("sums and counts rows per group", () => {
  const result = runCli([
    writeCsv("region,amount\nnorth,1\nsouth,2\nnorth,3\n"),
    "--group-by",
    "region",
    "--sum",
    "amount",
    "--count",
  ]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /north\s+4\s+2/);
  assert.match(result.stdout, /south\s+2\s+1/);
});

test("errors reading a missing schema file", () => {
  const result = runCli([writeCsv("region\nnorth\n"), "--schema", "/does/not/exist.json"]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /^error:/);
});

test("outputs json format with numeric values", () => {
  const result = runCli([
    writeCsv("region,amount\nnwest,1\nsouth,2\nnwest,3\n"),
    "--group-by",
    "region",
    "--sum",
    "amount",
    "--count",
    "--format",
    "json",
  ]);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(JSON.parse(result.stdout), [
    { region: "nwest", sum_amount: 4, count: 2 },
    { region: "south", sum_amount: 2, count: 1 },
  ]);
});

test("outputs csv format with quoted fields", () => {
  const result = runCli([
    writeCsv('name,amount\n"apple, inc",2\npear,3\n'),
    "--format",
    "csv",
  ]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, 'name,amount\n"apple, inc",2\npear,3\n');
});

test("--out writes output to a file and leaves stdout empty", () => {
  const tempDir = makeTempDir();
  const inputPath = join(tempDir, "input.csv");
  const outputPath = join(tempDir, "output.csv");
  writeFileSync(inputPath, "name,amount\napple,2\n");
  const result = runCli([inputPath, "--format", "csv", "--out", outputPath]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "");
  assert.equal(readFileSync(outputPath, "utf8"), "name,amount\napple,2\n");
});

test("errors on an unknown --format value", () => {
  const result = runCli([writeCsv("name,amount\napple,2\n"), "--format", "xml"]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /^usage:/);
});

test("errors on an unknown flag", () => {
  const result = runCli([writeCsv("name,amount\napple,2\n"), "--unknown"]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /^usage:/);
});

test("errors when --format is missing its value", () => {
  const result = runCli([writeCsv("name,amount\napple,2\n"), "--format"]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /^usage:/);
});
