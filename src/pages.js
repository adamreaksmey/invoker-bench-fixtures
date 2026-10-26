import { readdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

export const SLUG_PATTERN = /^[a-z0-9-]+$/;
const PAGE_EXTENSION = ".md";
const FRONT_MATTER_DELIMITER = "---";
const TITLE_KEY = "title:";
const TAGS_KEY = "tags:";
const HEADING_PREFIX = "# ";
const TAG_LIST_WRAPPER_PATTERN = /^\[(.*)\]$/;

export function pagePath(pagesDir, slug) {
  return join(pagesDir, `${slug}${PAGE_EXTENSION}`);
}

export function normalizeTags(rawTags) {
  if (rawTags === undefined || rawTags === null || rawTags === "") return [];
  const withoutBrackets = String(rawTags).trim().replace(TAG_LIST_WRAPPER_PATTERN, "$1");
  const seen = new Set();
  const tags = [];
  for (const part of withoutBrackets.split(",")) {
    const tag = part.trim().toLowerCase();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
  }
  return tags.sort();
}

function headingTitle(markdown) {
  const heading = markdown.split("\n").find((line) => line.startsWith(HEADING_PREFIX));
  return heading ? heading.slice(HEADING_PREFIX.length).trim() : undefined;
}

function parseFrontMatterFields(block) {
  let title;
  let tagsRaw;
  for (const line of block.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.toLowerCase().startsWith(TITLE_KEY)) {
      title = trimmed.slice(TITLE_KEY.length).trim();
      continue;
    }
    if (trimmed.toLowerCase().startsWith(TAGS_KEY)) {
      tagsRaw = trimmed.slice(TAGS_KEY.length).trim();
    }
  }
  return { title, tagsRaw };
}

function splitFrontMatter(markdown) {
  const lines = markdown.split("\n");
  if (lines[0] !== FRONT_MATTER_DELIMITER) {
    return { fields: {}, body: markdown };
  }
  const endIndex = lines.indexOf(FRONT_MATTER_DELIMITER, 1);
  if (endIndex === -1) {
    return { fields: {}, body: markdown };
  }
  const block = lines.slice(1, endIndex).join("\n");
  const body = lines.slice(endIndex + 1).join("\n");
  return { fields: parseFrontMatterFields(block), body };
}

export function parsePageContent(slug, markdown) {
  const { fields, body } = splitFrontMatter(markdown);
  const title = fields.title || headingTitle(body) || slug;
  const tags = normalizeTags(fields.tagsRaw);
  return { slug, title, tags, body };
}

export function titleFor(slug, markdown) {
  return parsePageContent(slug, markdown).title;
}

export function listSlugs(pagesDir) {
  return readdirSync(pagesDir)
    .filter((file) => file.endsWith(PAGE_EXTENSION))
    .map((file) => file.slice(0, -PAGE_EXTENSION.length))
    .filter((slug) => SLUG_PATTERN.test(slug))
    .sort();
}

export function readPage(pagesDir, slug) {
  const path = pagePath(pagesDir, slug);
  if (!existsSync(path)) return undefined;
  const markdown = readFileSync(path, "utf8");
  return parsePageContent(slug, markdown);
}

export function writePage(pagesDir, slug, body) {
  const existed = existsSync(pagePath(pagesDir, slug));
  writeFileSync(pagePath(pagesDir, slug), body);
  return existed;
}

export function deletePage(pagesDir, slug) {
  const path = pagePath(pagesDir, slug);
  if (!existsSync(path)) return false;
  rmSync(path);
  return true;
}
