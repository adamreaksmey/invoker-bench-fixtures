import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv } from "../src/parse.js";

const BOM = "\uFEFF";

test("parses simple unquoted fields", () => {
  const rows = parseCsv("name,amount\napple,2\npear,5");
  assert.deepEqual(rows, [{ name: "apple", amount: "2" }, { name: "pear", amount: "5" }]);
});

test("parses quoted fields containing commas", () => {
  const rows = parseCsv('name,note\n"apple, inc",founded\n"pear, ltd",started');
  assert.deepEqual(rows, [{ name: "apple, inc", note: "founded" }, { name: "pear, ltd", note: "started" }]);
});

test("parses quoted fields containing newlines", () => {
  const rows = parseCsv('name,note\napple,"multi\nline"\npear,"another\nline"');
  assert.deepEqual(rows, [{ name: "apple", note: "multi\nline" }, { name: "pear", note: "another\nline" }]);
});

test("parses escaped quotes inside quoted fields", () => {
  const rows = parseCsv('name,note\napple,"say ""hi"""');
  assert.deepEqual(rows, [{ name: "apple", note: 'say "hi"' }]);
});

test("parses CRLF line endings", () => {
  const rows = parseCsv("name,amount\r\napple,2\r\npear,5\r\n");
  assert.deepEqual(rows, [{ name: "apple", amount: "2" }, { name: "pear", amount: "5" }]);
});

test("parses LF line endings", () => {
  const rows = parseCsv("name,amount\napple,2\npear,5\n");
  assert.deepEqual(rows, [{ name: "apple", amount: "2" }, { name: "pear", amount: "5" }]);
});

test("strips an optional UTF-8 BOM", () => {
  const rows = parseCsv(`${BOM}name,amount\napple,2\n`);
  assert.deepEqual(rows, [{ name: "apple", amount: "2" }]);
});

test("handles a trailing newline", () => {
  const rows = parseCsv("name,amount\napple,2\npear,5\n");
  assert.deepEqual(rows, [{ name: "apple", amount: "2" }, { name: "pear", amount: "5" }]);
});

test("handles empty fields", () => {
  const rows = parseCsv("name,amount\napple,\n,5");
  assert.deepEqual(rows, [{ name: "apple", amount: "" }, { name: "", amount: "5" }]);
});

test("handles mixed quoted and unquoted fields", () => {
  const rows = parseCsv('name,amount,region\n"apple, inc",2,north\npear,3,south');
  assert.deepEqual(rows, [
    { name: "apple, inc", amount: "2", region: "north" },
    { name: "pear", amount: "3", region: "south" },
  ]);
});

test("returns an empty array for empty input", () => {
  const rows = parseCsv("");
  assert.deepEqual(rows, []);
});

test("returns an empty array for header only", () => {
  const rows = parseCsv("name,amount\n");
  assert.deepEqual(rows, []);
});

test("preserves spaces in unquoted fields", () => {
  const rows = parseCsv("name,amount\n  apple  , 2 ");
  assert.deepEqual(rows, [{ name: "  apple  ", amount: " 2 " }]);
});

test("treats doubled quotes as a single literal quote", () => {
  const rows = parseCsv('name\n""""');
  assert.deepEqual(rows, [{ name: '"' }]);
});
