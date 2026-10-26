# P4 — CSV report CLI: robust parsing, schema validation, output formats

## Product context

`csvreport` is a command-line tool used to summarize CSV exports (for example sales by region).
Today it splits lines on commas (breaking quoted fields), never validates input, and can only print
a text table to stdout.

## Required changes

1. **RFC 4180 parsing.** Support quoted fields, escaped quotes (`""`), commas and newlines inside
   quotes, CRLF or LF line endings, an optional UTF-8 BOM, and a trailing newline. The first record
   is the header.
2. **Schema validation** with `--schema <file.json>`:
   ```json
   { "columns": { "region": { "type": "string", "required": true, "enum": ["north", "south"] },
                  "amount": { "type": "number", "required": true, "min": 0 },
                  "qty":    { "type": "integer" },
                  "day":    { "type": "date" },
                  "paid":   { "type": "boolean" } } }
   ```
   - Types: `string`, `integer`, `number`, `date` (`YYYY-MM-DD`, a real calendar date),
     `boolean` (`true` / `false`). Empty cells are missing values; a missing required value is an error;
     missing optional values are allowed.
   - `enum` restricts allowed values; `min` / `max` apply to `integer` and `number`.
   - A schema column absent from the header → print `error: missing column <name>` to stderr, exit 2.
   - Each invalid cell prints one line to stderr: `row <n>: <column>: <message>`, where `<n>` is the
     1-based data row number (the header is not counted).
   - Default behaviour: if any row is invalid, print the errors, write nothing to stdout, exit 2.
   - `--skip-invalid`: drop invalid rows, still print their errors, then print
     `skipped <k> invalid row(s)` to stderr, and continue (exit 0).
   - `integer` / `number` columns are converted to numbers before aggregation and output.
3. **Aggregation.** `--group-by <col>` groups rows; `--sum <col>` adds a `sum_<col>` column
   (sums rounded to 2 decimal places); `--count` adds a `count` column. Groups are sorted by
   group key ascending (string comparison). Without `--group-by`, rows are output as-is (all columns,
   input order).
4. **Output formats.** `--format table|csv|json` (default `table`).
   - `json`: a JSON array of objects, pretty-printed with 2-space indentation and a trailing newline;
     numeric values are JSON numbers.
   - `csv`: header row then data rows, fields quoted per RFC 4180 only when needed, `\n` line endings,
     trailing newline.
   - `table`: human-readable aligned text (exact spacing is not part of the contract).
   - `--out <path>` writes the output to that file instead of stdout (stdout stays empty).
5. **Exit codes.** 0 success; 1 usage or I/O error (unknown flag, missing file, bad `--format`) with a
   message on stderr starting with `usage:` or `error:`; 2 validation errors.
6. **Tests.** Cover parsing edge cases, each validation rule, aggregation, and each output format.

## Contracts

- Entry point: `node bin/csvreport.js <input.csv> [options]` (also `npm` bin `csvreport`).
- Aggregated output column order: group column, then `sum_<col>` (if requested), then `count`
  (if requested).
- No runtime npm dependencies may be added (Node built-ins only).

## Out of scope

Excel formats, streaming of multi-GB files.

## Verification you can run

`npm test` and `npm run build`.
