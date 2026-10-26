const FRONT_MATTER_PATTERN = /^---\n([\s\S]*?)\n---(?:\n|$)/;
const HEADING_PREFIX = "# ";

function parseAttributeBlock(block) {
  const attributes = {};
  for (const line of block.split("\n")) {
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;
    const key = line.slice(0, colonIndex).trim();
    if (!key) continue;
    attributes[key] = line.slice(colonIndex + 1).trim();
  }
  return attributes;
}

function parseTagList(rawValue) {
  if (rawValue == null || rawValue === "") return [];
  const trimmed = String(rawValue).trim();
  const inner =
    trimmed.startsWith("[") && trimmed.endsWith("]")
      ? trimmed.slice(1, -1)
      : trimmed;
  const unique = new Set(
    inner
      .split(",")
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean),
  );
  return [...unique].sort();
}

export function parseFrontMatter(markdown) {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const match = FRONT_MATTER_PATTERN.exec(normalized);
  if (!match) return { attributes: {}, body: normalized };
  return {
    attributes: parseAttributeBlock(match[1]),
    body: normalized.slice(match[0].length),
  };
}

export function headingTitle(markdownBody) {
  const heading = markdownBody.split("\n").find((line) => line.startsWith(HEADING_PREFIX));
  return heading ? heading.slice(HEADING_PREFIX.length).trim() : undefined;
}

export function resolveTitle(slug, attributes, markdownBody) {
  if (typeof attributes.title === "string" && attributes.title.trim()) {
    return attributes.title.trim();
  }
  return headingTitle(markdownBody) ?? slug;
}

export function resolveTags(attributes) {
  return parseTagList(attributes.tags);
}
