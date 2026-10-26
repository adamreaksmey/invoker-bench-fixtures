# csvreport

Summarize CSV exports from the command line.

```bash
npm ci
npm test
npm run build
node bin/csvreport.js examples/sales.csv --group-by region --sum amount
```

## Usage

```text
csvreport <input.csv> [--schema <file.json>] [--skip-invalid]
  [--group-by <column>] [--sum <column>] [--count]
  [--format table|csv|json] [--out <path>]
```

The default format is an aligned table. Use `--format csv` or `--format json` to select another
output format. `--out <path>` writes the report to a file and leaves stdout empty. `--group-by`
sorts groups by key; `--sum` and `--count` add aggregate columns to grouped output.

An optional JSON schema validates and converts input values before reporting. Invalid rows produce
validation messages and exit with status 2; `--skip-invalid` drops those rows and reports how many
were skipped. Usage errors (including unknown flags and missing arguments) and file I/O errors
produce a message on stderr and exit with status 1. Unsupported `--format` values also exit 1.
