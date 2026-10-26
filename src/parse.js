export class CsvParseError extends Error {}

export function parseCsvRecords(input) {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const records = [];
  let record = [];
  let field = "";
  let quoted = false;
  let atFieldStart = true;
  const finishField = () => { record.push(field); field = ""; atFieldStart = true; };
  const finishRecord = () => { finishField(); if (record.length > 1 || record[0] !== "" || records.length > 0) records.push(record); record = []; };
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') { field += '"'; index += 1; } else quoted = false;
      } else field += character;
      continue;
    }
    if (character === '"' && atFieldStart) { quoted = true; atFieldStart = false; }
    else if (character === ",") finishField();
    else if (character === "\n" || character === "\r") { if (character === "\r" && text[index + 1] === "\n") index += 1; finishRecord(); }
    else { field += character; atFieldStart = false; }
  }
  if (quoted) throw new CsvParseError("unterminated quoted field");
  if (field.length > 0 || record.length > 0) finishRecord();
  const headers = records.shift() ?? [];
  if (headers.length === 0) throw new CsvParseError("CSV input has no header");
  if (headers.some((header) => header === "")) throw new CsvParseError("CSV header contains an empty column");
  if (new Set(headers).size !== headers.length) throw new CsvParseError("CSV header contains duplicate columns");
  const rows = records.map((cells) => {
    if (cells.length > headers.length) throw new CsvParseError("row has more fields than the header");
    return Object.fromEntries(headers.map((column, index) => [column, cells[index] ?? ""]));
  });
  return { headers, rows };
}

export function parseCsv(text) { return parseCsvRecords(text).rows; }
