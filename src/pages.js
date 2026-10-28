import { readdirSync, readFileSync, writeFileSync, rmSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

export const SLUG_PATTERN = /^[a-z0-9-]+$/;
const PAGE_EXTENSION = ".md";
const FRONT_MATTER_DELIMITER = "---";
const TAG_SEPARATOR = ",";
const HEADING_PREFIX = "# ";

export function pagePath(pagesDir, slug) {
  return join(pagesDir, `${slug}${PAGE_EXTENSION}`);
}

function splitLines(text) {
  return text.split(/\r?\n/);
}

function extractTagItems(rawValue) {
  if (!rawValue) return [];
  const trimmed = rawValue.trim();
  const inner = trimmed.startsWith("[") && trimmed.endsWith("]") ? trimmed.slice(1, -1) : trimmed;
  return inner.split(TAG_SEPARATOR).map((item) => item.trim().toLowerCase()).filter((item) => item.length > 0);
}

function normalizeTags(rawValue) {
  const uniqueTags = new Set(extractTagItems(rawValue));
  return [...uniqueTags].sort();
}

function parseFrontMatterLines(lines) {
  const fields = new Map();
  for (const line of lines) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) continue;
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    fields.set(key, value);
  }
  return fields;
}

function extractFrontMatter(content) {
  const lines = splitLines(content);
  if (lines[0] !== FRONT_MATTER_DELIMITER) return { fields: new Map(), body: content };
  const endIndex = lines.indexOf(FRONT_MATTER_DELIMITER, 1);
  if (endIndex === -1) return { fields: new Map(), body: content };
  const fields = parseFrontMatterLines(lines.slice(1, endIndex));
  const body = lines.slice(endIndex + 1).join("\n");
  return { fields, body };
}

function titleFromHeading(body) {
  const heading = splitLines(body).find((line) => line.startsWith(HEADING_PREFIX));
  return heading ? heading.slice(HEADING_PREFIX.length).trim() : undefined;
}

export function parsePage(slug, content) {
  const { fields, body } = extractFrontMatter(content);
  const frontMatterTitle = fields.get("title")?.trim();
  const title = frontMatterTitle || titleFromHeading(body) || slug;
  const tags = normalizeTags(fields.get("tags"));
  return { slug, title, tags, body };
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
  return parsePage(slug, readFileSync(path, "utf8"));
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

export function pageModifiedAt(pagesDir, slug) {
  const path = pagePath(pagesDir, slug);
  if (!existsSync(path)) return undefined;
  return statSync(path).mtimeMs;
}
