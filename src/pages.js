import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const SLUG_PATTERN = /^[a-z0-9-]+$/;
const PAGE_EXTENSION = ".md";

function unquote(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1);
  return trimmed;
}

export function parseFrontMatter(markdown) {
  const lines = markdown.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return { title: undefined, tags: [], body: markdown };
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (end < 0) return { title: undefined, tags: [], body: markdown };
  let title;
  let rawTags = "";
  for (const line of lines.slice(1, end)) {
    const match = line.match(/^\s*([\w-]+)\s*:\s*(.*?)\s*$/);
    if (!match) continue;
    if (match[1] === "title") title = unquote(match[2]);
    if (match[1] === "tags") rawTags = match[2];
  }
  const tagText = rawTags.trim().replace(/^\[/, "").replace(/\]$/, "");
  const tags = [...new Set(tagText.split(",").map((tag) => unquote(tag).trim().toLowerCase()).filter(Boolean))].sort();
  return { title: title || undefined, tags, body: lines.slice(end + 1).join("\n").replace(/^\n/, "") };
}

export function pagePath(pagesDir, slug) {
  return join(pagesDir, `${slug}${PAGE_EXTENSION}`);
}

export function titleFor(slug, markdown) {
  const parsed = parseFrontMatter(markdown);
  if (parsed.title) return parsed.title;
  const heading = parsed.body.split("\n").find((line) => line.startsWith("# "));
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
  const markdown = readFileSync(path, "utf8");
  const parsed = parseFrontMatter(markdown);
  return { slug, title: parsed.title || titleFor(slug, markdown), tags: parsed.tags, body: parsed.body };
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
