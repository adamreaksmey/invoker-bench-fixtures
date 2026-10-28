const CARRIAGE_RETURN = "\r";
const COMMA = ",";
const DOUBLE_QUOTE = '"';
const LINE_FEED = "\n";
const BOM = "\uFEFF";

function isLineEnding(text, index) {
  const char = text[index];
  const nextChar = text[index + 1];
  return char === LINE_FEED || (char === CARRIAGE_RETURN && nextChar === LINE_FEED);
}

function consumeLineEnding(text, index) {
  if (text[index] === CARRIAGE_RETURN && text[index + 1] === LINE_FEED) {
    return index + 2;
  }
  return index + 1;
}

export function parseCsv(text) {
  const bomFreeText = text.startsWith(BOM) ? text.slice(1) : text;
  const records = [];
  let currentRecord = [];
  let currentField = "";
  let insideQuotes = false;
  let index = 0;

  while (index < bomFreeText.length) {
    const char = bomFreeText[index];

    if (insideQuotes) {
      if (char === DOUBLE_QUOTE) {
        const nextChar = bomFreeText[index + 1];
        if (nextChar === DOUBLE_QUOTE) {
          currentField += DOUBLE_QUOTE;
          index += 2;
        } else {
          insideQuotes = false;
          index += 1;
        }
      } else {
        currentField += char;
        index += 1;
      }
    } else if (char === DOUBLE_QUOTE) {
      insideQuotes = true;
      index += 1;
    } else if (char === COMMA) {
      currentRecord.push(currentField);
      currentField = "";
      index += 1;
    } else if (isLineEnding(bomFreeText, index)) {
      currentRecord.push(currentField);
      records.push(currentRecord);
      currentRecord = [];
      currentField = "";
      index = consumeLineEnding(bomFreeText, index);
    } else {
      currentField += char;
      index += 1;
    }
  }

  if (currentRecord.length > 0 || currentField.length > 0) {
    currentRecord.push(currentField);
    records.push(currentRecord);
  }

  return records;
}
