import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/cli.js";

function writeFile(contents, extension = "csv") {
  const path = join(mkdtempSync(join(tmpdir(), "csvreport-")), `input.${extension}`);
  writeFileSync(path, contents);
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
  const result = runCli([writeFile("name,qty\napple,2\npear,5\n")]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /apple\s+2/);
  assert.match(result.stdout, /pear\s+5/);
});

test("groups and sums a column", () => {
  const result = runCli([
    writeFile("region,amount\nnorth,1\nsouth,2\nnorth,3\n"),
    "--group-by", "region",
    "--sum", "amount",
  ]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /north\s+4/);
  assert.match(result.stdout, /south\s+2/);
});

test("prints usage without an input file", () => {
  const result = runCli([]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /^usage:/);
});

test("validates with a schema and exits 2 on invalid rows", () => {
  const schemaPath = writeFile(JSON.stringify({
    columns: { amount: { type: "number", required: true } },
  }), "json");
  const result = runCli([writeFile("amount\n10\nnot-a-number\n"), "--schema", schemaPath]);
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /row 2: amount: expected number/);
  assert.equal(result.stdout, "");
});

test("skips invalid rows with --skip-invalid", () => {
  const schemaPath = writeFile(JSON.stringify({
    columns: { amount: { type: "number" } },
  }), "json");
  const result = runCli([
    writeFile("amount\n10\nbad\n20\n"),
    "--schema", schemaPath,
    "--skip-invalid",
    "--format", "csv",
  ]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stderr, /row 2: amount: expected number/);
  assert.match(result.stderr, /skipped 1 invalid row\(s\)/);
  assert.equal(result.stdout, "amount\n10\n20\n");
});

test("exits 2 when schema column is missing", () => {
  const schemaPath = writeFile(JSON.stringify({
    columns: { missing: { type: "string", required: true } },
  }), "json");
  const result = runCli([writeFile("present\nx\n"), "--schema", schemaPath]);
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /error: missing column missing/);
  assert.equal(result.stdout, "");
});

test("outputs csv format", () => {
  const result = runCli([writeFile("a,b\n1,2\n"), "--format", "csv"]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "a,b\n1,2\n");
});

test("outputs json format", () => {
  const result = runCli([writeFile("a,b\n1,2\n"), "--format", "json"]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, '[\n  {\n    "a": "1",\n    "b": "2"\n  }\n]\n');
});

test("writes output to a file with --out", () => {
  const outputPath = join(mkdtempSync(join(tmpdir(), "csvreport-out-")), "output.csv");
  const result = runCli([writeFile("a,b\n1,2\n"), "--format", "csv", "--out", outputPath]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "");
  assert.equal(readFileSync(outputPath, "utf8"), "a,b\n1,2\n");
});

test("exits 1 on an unknown flag", () => {
  const result = runCli([writeFile("a\n1\n"), "--unknown"]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /^error:/);
});

test("exits 1 on a bad format", () => {
  const result = runCli([writeFile("a\n1\n"), "--format", "xml"]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /error: unknown format/);
});

test("exits 1 on a missing input file", () => {
  const result = runCli(["/does/not/exist.csv"]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /^error:/);
});

test("includes count in aggregated output", () => {
  const result = runCli([
    writeFile("region,amount\nnorth,1\nnorth,2\nsouth,3\n"),
    "--group-by", "region",
    "--sum", "amount",
    "--count",
    "--format", "csv",
  ]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "region,sum_amount,count\nnorth,3,2\nsouth,3,1\n");
});

test("handles quoted csv input with newlines", () => {
  const result = runCli([writeFile('note\n"line1\nline2"\n'), "--format", "csv"]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, 'note\n"line1\nline2"\n');
});
