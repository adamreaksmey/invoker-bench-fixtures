const BOM = "\uFEFF";
const COMMA = ",";
const QUOTE = '"';
const CARRIAGE_RETURN = "\r";
const LINE_FEED = "\n";

export function parseCsv(text) {
  const input = text.startsWith(BOM) ? text.slice(1) : text;
  const records = parseRecords(input);
  if (records.length === 0) return [];
  const [header, ...dataRows] = records;
  return dataRows.map((row) => Object.fromEntries(header.map((column, index) => [column, row[index] ?? ""])));
}

function parseRecords(text) {
  const records = [];
  let index = 0;
  while (index < text.length) {
    const record = parseRecord(text, index);
    records.push(record.fields);
    index = record.nextIndex;
  }
  return records;
}

function parseRecord(text, startIndex) {
  const fields = [];
  let index = startIndex;
  while (true) {
    const parsedField = parseField(text, index);
    fields.push(parsedField.value);
    index = parsedField.nextIndex;
    if (index >= text.length) break;
    if (text[index] === COMMA) {
      index += 1;
      continue;
    }
    if (text[index] === LINE_FEED) {
      index += 1;
      break;
    }
    if (text[index] === CARRIAGE_RETURN && text[index + 1] === LINE_FEED) {
      index += 2;
      break;
    }
  }
  return { fields, nextIndex: index };
}

function parseField(text, startIndex) {
  if (text[startIndex] === QUOTE) return parseQuotedField(text, startIndex);
  return parseUnquotedField(text, startIndex);
}

function parseUnquotedField(text, startIndex) {
  const chars = [];
  let index = startIndex;
  while (index < text.length && !isFieldTerminator(text, index)) {
    chars.push(text[index]);
    index += 1;
  }
  return { value: chars.join(""), nextIndex: index };
}

function isFieldTerminator(text, index) {
  if (text[index] === COMMA) return true;
  if (text[index] === LINE_FEED) return true;
  return text[index] === CARRIAGE_RETURN && text[index + 1] === LINE_FEED;
}

function parseQuotedField(text, startIndex) {
  const chars = [];
  let index = startIndex + 1;
  while (index < text.length) {
    const char = text[index];
    if (char !== QUOTE) {
      chars.push(char);
      index += 1;
      continue;
    }
    if (text[index + 1] === QUOTE) {
      chars.push(QUOTE);
      index += 2;
      continue;
    }
    index += 1;
    break;
  }
  return { value: chars.join(""), nextIndex: index };
}
