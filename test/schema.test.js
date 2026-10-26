import { test } from "node:test";
import assert from "node:assert/strict";
import { validateRows } from "../src/schema.js";

const HEADER = ["region", "amount", "qty", "day", "paid"];

function schemaWith(columns) {
  return { columns };
}

test("accepts valid rows and converts integer and number columns", () => {
  const rows = [
    {
      region: "north",
      amount: "10.5",
      qty: "3",
      day: "2024-01-15",
      paid: "true",
    },
  ];
  const result = validateRows(
    rows,
    HEADER,
    schemaWith({
      region: { type: "string", required: true, enum: ["north", "south"] },
      amount: { type: "number", required: true, min: 0 },
      qty: { type: "integer" },
      day: { type: "date" },
      paid: { type: "boolean" },
    })
  );
  assert.equal(result.invalidRowCount, 0);
  assert.deepEqual(result.rows, [
    {
      region: "north",
      amount: 10.5,
      qty: 3,
      day: "2024-01-15",
      paid: "true",
    },
  ]);
});

test("reports missing schema columns", () => {
  const result = validateRows(
    [{ amount: "1" }],
    ["amount"],
    schemaWith({ region: { type: "string", required: true } })
  );
  assert.equal(result.missingColumn, "region");
});

test("rejects missing required values with 1-based row numbers", () => {
  const result = validateRows(
    [{ region: "" }, { region: "north" }],
    ["region"],
    schemaWith({ region: { type: "string", required: true } })
  );
  assert.deepEqual(result.errors, ["row 1: region: required value missing"]);
  assert.equal(result.invalidRowCount, 1);
  assert.deepEqual(result.rows, [{ region: "north" }]);
});

test("allows missing optional values", () => {
  const result = validateRows(
    [{ qty: "" }],
    ["qty"],
    schemaWith({ qty: { type: "integer" } })
  );
  assert.equal(result.invalidRowCount, 0);
  assert.deepEqual(result.rows, [{ qty: "" }]);
});

test("rejects values outside enum", () => {
  const result = validateRows(
    [{ region: "east" }],
    ["region"],
    schemaWith({ region: { type: "string", enum: ["north", "south"] } })
  );
  assert.deepEqual(result.errors, ["row 1: region: not in enum"]);
});

test("rejects invalid integer, number, date, and boolean cells", () => {
  const result = validateRows(
    [{ qty: "1.5", amount: "x", day: "2024-02-30", paid: "yes" }],
    ["qty", "amount", "day", "paid"],
    schemaWith({
      qty: { type: "integer" },
      amount: { type: "number" },
      day: { type: "date" },
      paid: { type: "boolean" },
    })
  );
  assert.deepEqual(result.errors, [
    "row 1: qty: invalid integer",
    "row 1: amount: invalid number",
    "row 1: day: invalid date",
    "row 1: paid: invalid boolean",
  ]);
});

test("rejects non-calendar dates that match YYYY-MM-DD shape", () => {
  const result = validateRows(
    [{ day: "2023-02-29" }],
    ["day"],
    schemaWith({ day: { type: "date" } })
  );
  assert.deepEqual(result.errors, ["row 1: day: invalid date"]);
});

test("enforces min and max on integer and number columns", () => {
  const result = validateRows(
    [
      { amount: "-1", qty: "11" },
      { amount: "5", qty: "0" },
    ],
    ["amount", "qty"],
    schemaWith({
      amount: { type: "number", min: 0 },
      qty: { type: "integer", max: 10 },
    })
  );
  assert.deepEqual(result.errors, [
    "row 1: amount: below minimum",
    "row 1: qty: above maximum",
  ]);
  assert.equal(result.invalidRowCount, 1);
});

test("keeps valid rows when some rows are invalid", () => {
  const result = validateRows(
    [{ qty: "2" }, { qty: "nope" }, { qty: "4" }],
    ["qty"],
    schemaWith({ qty: { type: "integer" } })
  );
  assert.equal(result.invalidRowCount, 1);
  assert.deepEqual(result.rows, [{ qty: 2 }, { qty: 4 }]);
  assert.deepEqual(result.errors, ["row 2: qty: invalid integer"]);
});
