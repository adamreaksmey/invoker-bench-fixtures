# csvreport

Summarize CSV exports from the command line.

```bash
npm ci
npm test
npm run build
node bin/csvreport.js examples/sales.csv --group-by region --sum amount
```

The command accepts an input CSV followed by these options:

```text
--group-by <column>       Group rows by a column
--sum <column>            Add a rounded sum column to grouped output
--count                   Add a count column to grouped output
--schema <file.json>      Validate rows against a JSON schema
--skip-invalid            Drop invalid rows after reporting validation errors
--format table|csv|json   Select the output format (default: table)
--out <path>              Write output to a file instead of stdout
```

Without `--group-by`, rows are emitted in their input order. The `json` format
is pretty-printed, and the `csv` format uses RFC 4180 quoting with LF line
endings. A schema converts valid `integer` and `number` values to numbers
before output and aggregation.

Usage and I/O errors (including unknown flags, missing or unreadable files, and
an invalid format) are written to stderr and exit with status 1. Schema
validation errors are written to stderr and exit with status 2; use
`--skip-invalid` to continue with the valid rows.
