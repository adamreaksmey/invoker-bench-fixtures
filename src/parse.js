const UTF8_BOM = "\uFEFF";
const QUOTE = '"';
const COMMA = ",";
const CR = "\r";
const LF = "\n";

function stripBom(text) {
  return text.startsWith(UTF8_BOM) ? text.slice(UTF8_BOM.length) : text;
}

function isLineBreak(character) {
  return character === CR || character === LF;
}

function advancePastLineBreak(text, index) {
  if (text[index] === CR && text[index + 1] === LF) return index + 2;
  if (isLineBreak(text[index])) return index + 1;
  return index;
}

function readQuotedField(text, startIndex) {
  let index = startIndex + 1;
  let field = "";
  while (index < text.length) {
    const character = text[index];
    if (character !== QUOTE) {
      field += character;
      index += 1;
      continue;
    }
    if (text[index + 1] === QUOTE) {
      field += QUOTE;
      index += 2;
      continue;
    }
    return { field, nextIndex: index + 1 };
  }
  throw new Error("unterminated quoted field");
}

function readUnquotedField(text, startIndex) {
  let index = startIndex;
  while (index < text.length && text[index] !== COMMA && !isLineBreak(text[index])) {
    index += 1;
  }
  return { field: text.slice(startIndex, index), nextIndex: index };
}

function readField(text, startIndex) {
  if (text[startIndex] === QUOTE) return readQuotedField(text, startIndex);
  return readUnquotedField(text, startIndex);
}

function readRecord(text, startIndex) {
  const fields = [];
  let index = startIndex;
  while (index <= text.length) {
    const { field, nextIndex } = readField(text, index);
    fields.push(field);
    index = nextIndex;
    if (index >= text.length) return { fields, nextIndex: index };
    if (isLineBreak(text[index])) {
      return { fields, nextIndex: advancePastLineBreak(text, index) };
    }
    if (text[index] !== COMMA) throw new Error("expected comma or line break");
    index += 1;
  }
  return { fields, nextIndex: index };
}

function parseRecords(text) {
  if (text.length === 0) return [];
  const records = [];
  let index = 0;
  while (index < text.length) {
    const { fields, nextIndex } = readRecord(text, index);
    records.push(fields);
    index = nextIndex;
  }
  return records;
}

function rowFromCells(columns, cells) {
  return Object.fromEntries(columns.map((column, index) => [column, cells[index] ?? ""]));
}

/** Parse RFC 4180 CSV text into header columns and row objects. */
export function parseCsv(text) {
  const records = parseRecords(stripBom(text));
  if (records.length === 0) return { columns: [], rows: [] };
  const [columns, ...dataRecords] = records;
  return { columns, rows: dataRecords.map((cells) => rowFromCells(columns, cells)) };
}
