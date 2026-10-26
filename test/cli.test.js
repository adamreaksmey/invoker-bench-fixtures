import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/cli.js";

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

test("prints rows as a table", () => {
  const result = runCli([writeCsv("name,qty\napple,2\npear,5\n")]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /apple\s+2/);
  assert.match(result.stdout, /pear\s+5/);
});

test("groups and sums a column", () => {
  const result = runCli([
    writeCsv("region,amount\nnorth,1\nsouth,2\nnorth,3\n"),
    "--group-by",
    "region",
    "--sum",
    "amount",
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

test("exits 2 with empty stdout when schema validation fails", () => {
  const schemaPath = writeSchema({
    amount: { type: "number", required: true, min: 0 },
  });
  const result = runCli([
    writeCsv("amount\n-1\n2\n"),
    "--schema",
    schemaPath,
  ]);
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /^row 1: amount: below minimum\n$/);
});

test("reports missing schema columns on stderr and exits 2", () => {
  const schemaPath = writeSchema({
    region: { type: "string", required: true },
  });
  const result = runCli([
    writeCsv("amount\n1\n"),
    "--schema",
    schemaPath,
  ]);
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "error: missing column region\n");
});

test("skips invalid rows with --skip-invalid and continues", () => {
  const schemaPath = writeSchema({
    qty: { type: "integer", required: true },
  });
  const result = runCli([
    writeCsv("name,qty\napple,2\nbad,x\npear,5\n"),
    "--schema",
    schemaPath,
    "--skip-invalid",
  ]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /apple\s+2/);
  assert.match(result.stdout, /pear\s+5/);
  assert.doesNotMatch(result.stdout, /bad/);
  assert.match(result.stderr, /row 2: qty: invalid integer/);
  assert.match(result.stderr, /skipped 1 invalid row\(s\)/);
});

test("converts numeric schema columns before grouping", () => {
  const schemaPath = writeSchema({
    region: { type: "string", required: true },
    amount: { type: "number", required: true },
  });
  const result = runCli([
    writeCsv("region,amount\nnorth,1.5\nnorth,2.5\n"),
    "--schema",
    schemaPath,
    "--group-by",
    "region",
    "--sum",
    "amount",
  ]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /north\s+4/);
});
