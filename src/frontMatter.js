const FRONT_MATTER_DELIMITER = "---";

export function parsePage(slug, markdown) {
  const { frontMatter, body } = splitFrontMatter(markdown);
  const title = parseStringValue(frontMatter.title) ?? firstHeading(body) ?? slug;
  const tags = normalizeTags(frontMatter.tags);
  return { slug, title, tags, body };
}

function splitFrontMatter(markdown) {
  const lines = markdown.split("\n");
  if (lines[0]?.trim() !== FRONT_MATTER_DELIMITER) {
    return { frontMatter: {}, body: markdown };
  }
  const closingIndex = findClosingDelimiter(lines);
  if (closingIndex === -1) {
    return { frontMatter: {}, body: markdown };
  }
  const frontMatterText = lines.slice(1, closingIndex).join("\n");
  const body = lines.slice(closingIndex + 1).join("\n");
  return { frontMatter: parseKeyValuePairs(frontMatterText), body };
}

function findClosingDelimiter(lines) {
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === FRONT_MATTER_DELIMITER) return index;
  }
  return -1;
}

function parseKeyValuePairs(text) {
  const result = {};
  for (const line of text.split("\n")) {
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;
    const key = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 1).trim();
    result[key] = value;
  }
  return result;
}

function parseStringValue(value) {
  if (typeof value !== "string" || value.length === 0) return undefined;
  const unquoted = stripOuterQuotes(value.trim());
  return unquoted.length > 0 ? unquoted : undefined;
}

function stripOuterQuotes(value) {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  const hasMatchingQuotes = (first === '"' && last === '"') || (first === "'" && last === "'");
  if (!hasMatchingQuotes) return value;
  return value.slice(1, -1).trim();
}

function firstHeading(body) {
  const match = body.match(/^# (.+)$/m);
  const heading = match?.[1];
  return heading ? heading.trim() : undefined;
}

function normalizeTags(raw) {
  if (!raw) return [];
  const text = raw.trim();
  if (text.length === 0) return [];
  const segments = isBracketList(text) ? text.slice(1, -1).split(",") : text.split(",");
  return collectUniqueLowercaseTags(segments);
}

function isBracketList(text) {
  return text.startsWith("[") && text.endsWith("]");
}

function collectUniqueLowercaseTags(segments) {
  const seen = new Set();
  const tags = [];
  for (const segment of segments) {
    const tag = parseStringValue(segment)?.toLowerCase();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
  }
  return tags.sort();
}
