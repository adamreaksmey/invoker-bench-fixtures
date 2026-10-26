import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv } from "../src/parse.js";

test("parses quoted fields", () => {
  assert.deepEqual(parseCsv('name,comment\n"Ada Lovelace","A mathematician"'), [
    { name: "Ada Lovelace", comment: "A mathematician" },
  ]);
});

test("parses escaped quotes", () => {
  assert.deepEqual(parseCsv('name,quote\nAda,"She said ""hello"""'), [
    { name: "Ada", quote: 'She said "hello"' },
  ]);
});

test("parses commas inside quoted fields", () => {
  assert.deepEqual(parseCsv('name,address\nAda,"London, England"'), [
    { name: "Ada", address: "London, England" },
  ]);
});

test("parses newlines inside quoted fields", () => {
  assert.deepEqual(parseCsv('name,note\nAda,"line one\nline two"\nBob,done'), [
    { name: "Ada", note: "line one\nline two" },
    { name: "Bob", note: "done" },
  ]);
});

test("accepts CRLF and LF line endings", () => {
  assert.deepEqual(parseCsv("name,qty\r\nAda,1\nBob,2\r\n"), [
    { name: "Ada", qty: "1" },
    { name: "Bob", qty: "2" },
  ]);
});

test("accepts an optional UTF-8 BOM", () => {
  assert.deepEqual(parseCsv("\uFEFFname,qty\nAda,1"), [
    { name: "Ada", qty: "1" },
  ]);
});

test("accepts an optional trailing newline", () => {
  assert.deepEqual(parseCsv("name,qty\nAda,1\n"), [
    { name: "Ada", qty: "1" },
  ]);
});
