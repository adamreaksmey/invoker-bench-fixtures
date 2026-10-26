import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv } from "../src/parse.js";

test("uses the first record as the header", () => {
  assert.deepEqual(parseCsv("name,qty\napple,2"), [{ name: "apple", qty: "2" }]);
});

test("parses quoted fields", () => {
  assert.deepEqual(parseCsv('name,note\n"apple","fresh fruit"\n'), [
    { name: "apple", note: "fresh fruit" },
  ]);
});

test("parses escaped quotes", () => {
  assert.deepEqual(parseCsv('name,note\n"Apple","She said ""hello"""\n'), [
    { name: "Apple", note: 'She said "hello"' },
  ]);
});

test("parses commas inside quoted fields", () => {
  assert.deepEqual(parseCsv('name,address\nApple,"123 Main St, Phnom Penh"'), [
    { name: "Apple", address: "123 Main St, Phnom Penh" },
  ]);
});

test("parses newlines inside quoted fields", () => {
  assert.deepEqual(parseCsv('name,note\nApple,"line one\nline two"\nPear,ok'), [
    { name: "Apple", note: "line one\nline two" },
    { name: "Pear", note: "ok" },
  ]);
});

test("accepts CRLF line endings", () => {
  assert.deepEqual(parseCsv("name,qty\r\napple,2\r\npear,5\r\n"), [
    { name: "apple", qty: "2" },
    { name: "pear", qty: "5" },
  ]);
});

test("accepts an optional UTF-8 BOM", () => {
  assert.deepEqual(parseCsv("\ufeffname,qty\napple,2"), [{ name: "apple", qty: "2" }]);
});

test("accepts an optional trailing newline", () => {
  assert.deepEqual(parseCsv("name\napple\n"), [{ name: "apple" }]);
  assert.deepEqual(parseCsv("name\napple"), [{ name: "apple" }]);
});
