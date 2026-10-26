import { readdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

export const SLUG_PATTERN = /^[a-z0-9-]+$/;
const PAGE_EXTENSION = ".md";

export function pagePath(pagesDir, slug) {
  return join(pagesDir, `${slug}${PAGE_EXTENSION}`);
}

function parseTags(value) {
  const list = value.trim().replace(/^\[/, "").replace(/\]$/, "");
  return [...new Set(list.split(",").map((tag) => tag.trim().toLowerCase()).filter(Boolean))].sort();
}

export function parseFrontMatter(markdown) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return { title: undefined, tags: [], body: markdown };

  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^\s*([A-Za-z][\w-]*):\s*(.*)$/);
    if (field) fields[field[1].toLowerCase()] = field[2].trim();
  }

  return {
    title: fields.title || undefined,
    tags: fields.tags ? parseTags(fields.tags) : [],
    body: markdown.slice(match[0].length),
  };
}

export function titleFor(slug, markdown) {
  const heading = markdown.split(/\r?\n/).find((line) => line.startsWith("# "));
  return heading ? heading.slice(2).trim() : slug;
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
  const parsed = parseFrontMatter(readFileSync(path, "utf8"));
  return {
    slug,
    title: parsed.title || titleFor(slug, parsed.body),
    tags: parsed.tags,
    body: parsed.body,
  };
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
