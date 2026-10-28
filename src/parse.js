export const UTF8_BOM = "\uFEFF";
export const FIELD_SEPARATOR = ",";
export const QUOTE = '"';
export const CARRIAGE_RETURN = "\r";
export const LINE_FEED = "\n";

const ESCAPED_QUOTE_LENGTH = 2;
const RECORD_TERMINATORS = new Set([CARRIAGE_RETURN, LINE_FEED]);
const MISSING_CELL_VALUE = "";

/**
 * Parses RFC 4180 CSV text into row objects keyed by the header record.
 * Supports quoted fields, escaped quotes (`""`), commas and newlines inside
 * quotes, CRLF or LF terminators, an optional UTF-8 BOM, and a trailing newline.
 * Malformed input is read leniently: text after a closing quote is appended to
 * the field, and an unterminated quote consumes the remaining input.
 */
export function parseCsv(text) {
  const [headerRecord, ...dataRecords] = tokenizeRecords(stripBom(text));
  if (headerRecord === undefined) return [];
  return dataRecords.map((record) => toRow(headerRecord.fields, record.fields));
}

function stripBom(text) {
  return text.startsWith(UTF8_BOM) ? text.slice(UTF8_BOM.length) : text;
}

/**
 * Splits text into records. Blank records (an unquoted, single empty field)
 * are dropped so stray empty lines do not produce phantom rows.
 */
function tokenizeRecords(text) {
  const records = [];
  let index = 0;
  while (index < text.length) {
    const record = readRecord(text, index);
    if (!isBlankRecord(record)) records.push(record);
    index = record.nextIndex;
  }
  return records;
}

function readRecord(text, startIndex) {
  const fields = [];
  let hasQuotedField = false;
  let index = startIndex;
  for (;;) {
    const field = readField(text, index);
    fields.push(field.value);
    hasQuotedField = hasQuotedField || field.isQuoted;
    index = field.nextIndex;
    if (text[index] !== FIELD_SEPARATOR) break;
    index += 1;
  }
  return { fields, hasQuotedField, nextIndex: skipRecordTerminator(text, index) };
}

function readField(text, startIndex) {
  if (text[startIndex] !== QUOTE) {
    const unquoted = readUnquotedField(text, startIndex);
    return { value: unquoted.value, nextIndex: unquoted.nextIndex, isQuoted: false };
  }
  const quoted = readQuotedField(text, startIndex);
  const trailing = readUnquotedField(text, quoted.nextIndex);
  return { value: quoted.value + trailing.value, nextIndex: trailing.nextIndex, isQuoted: true };
}

function readUnquotedField(text, startIndex) {
  let index = startIndex;
  while (index < text.length && !isFieldBoundary(text[index])) index += 1;
  return { value: text.slice(startIndex, index), nextIndex: index };
}

function readQuotedField(text, startIndex) {
  let value = "";
  let segmentStart = startIndex + 1;
  let index = segmentStart;
  while (index < text.length) {
    if (text[index] !== QUOTE) {
      index += 1;
      continue;
    }
    if (text[index + 1] === QUOTE) {
      value += text.slice(segmentStart, index) + QUOTE;
      index += ESCAPED_QUOTE_LENGTH;
      segmentStart = index;
      continue;
    }
    return { value: value + text.slice(segmentStart, index), nextIndex: index + 1 };
  }
  return { value: value + text.slice(segmentStart), nextIndex: text.length };
}

function isFieldBoundary(character) {
  return character === FIELD_SEPARATOR || RECORD_TERMINATORS.has(character);
}

function skipRecordTerminator(text, index) {
  if (text[index] === CARRIAGE_RETURN && text[index + 1] === LINE_FEED) return index + 2;
  if (RECORD_TERMINATORS.has(text[index])) return index + 1;
  return index;
}

function isBlankRecord(record) {
  return !record.hasQuotedField && record.fields.length === 1 && record.fields[0] === "";
}

function toRow(header, fields) {
  const toEntry = (column, index) => [column, fields[index] ?? MISSING_CELL_VALUE];
  return Object.fromEntries(header.map(toEntry));
}
