import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/cli.js";

const USAGE_ERROR_PATTERN = /^(usage|error): /;

function temporaryDirectory(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function writeCsv(contents) {
  const path = join(temporaryDirectory("csvreport-"), "input.csv");
  writeFileSync(path, contents);
  return path;
}

function runCli(argv) {
  const output = { stdout: "", stderr: "" };
  const exitCode = run(argv, { stdout: (text) => { output.stdout += text; }, stderr: (text) => { output.stderr += text; } });
  return { exitCode, ...output };
}

function assertUsageFailure(result) {
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, USAGE_ERROR_PATTERN);
  assert.equal(result.stdout, "");
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
  assertUsageFailure(result);
  assert.match(result.stderr, /^usage:/);
});

test("rejects an unknown flag instead of treating it as the input file", () => {
  const result = runCli([writeCsv("name\napple\n"), "--bogus"]);
  assertUsageFailure(result);
  assert.equal(result.stderr, "error: unknown option --bogus\n");
});

test("rejects an unknown flag given before the input file", () => {
  const result = runCli(["--bogus", writeCsv("name\napple\n")]);
  assertUsageFailure(result);
  assert.equal(result.stderr, "error: unknown option --bogus\n");
});

test("rejects a missing input file on disk", () => {
  const missingPath = join(temporaryDirectory("csvreport-missing-"), "absent.csv");
  const result = runCli([missingPath]);
  assertUsageFailure(result);
  assert.equal(result.stderr, `error: cannot read input file ${missingPath}\n`);
});

test("rejects an unreadable input file", () => {
  const directoryPath = join(temporaryDirectory("csvreport-unreadable-"), "directory.csv");
  mkdirSync(directoryPath);
  const result = runCli([directoryPath]);
  assertUsageFailure(result);
  assert.equal(result.stderr, `error: cannot read input file ${directoryPath}\n`);
});

test("rejects a value option with no value", () => {
  for (const option of ["--group-by", "--sum", "--schema", "--format", "--out"]) {
    const result = runCli([writeCsv("name\napple\n"), option]);
    assertUsageFailure(result);
    assert.equal(result.stderr, `error: missing value for ${option}\n`);
  }
});

test("rejects a value option followed by another option", () => {
  const result = runCli([writeCsv("name\napple\n"), "--group-by", "--count"]);
  assertUsageFailure(result);
  assert.equal(result.stderr, "error: missing value for --group-by\n");
});

test("rejects a second positional argument as an unexpected argument", () => {
  const result = runCli([writeCsv("name\napple\n"), "extra.csv"]);
  assertUsageFailure(result);
  assert.equal(result.stderr, "error: unexpected argument extra.csv\n");
});

test("writes nothing to stdout for a usage error even though the input is valid", () => {
  const result = runCli([writeCsv("name\napple\n"), "--format", "xml"]);
  assertUsageFailure(result);
  assert.equal(result.stderr, "error: unsupported --format xml\n");
});
