import { readdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

export const SLUG_PATTERN = /^[a-z0-9-]+$/;
const PAGE_EXTENSION = ".md";

export function pagePath(pagesDir, slug) {
  return join(pagesDir, `${slug}${PAGE_EXTENSION}`);
}

export function parsePage(slug, markdown) {
  let content = markdown;
  let frontMatter = "";
  const opening = /^(?:\uFEFF)?---\r?\n/.exec(markdown);
  if (opening) {
    const closing = /^(?:---|\.\.\.)[ \t]*\r?$/m;
    const rest = markdown.slice(opening[0].length);
    const match = closing.exec(rest);
    if (match) {
      frontMatter = rest.slice(0, match.index);
      content = rest.slice(match.index + match[0].length).replace(/^\r?\n/, "");
    }
  }

  let frontTitle;
  let tags = [];
  for (const line of frontMatter.split(/\r?\n/)) {
    const field = /^\s*(title|tags)\s*:\s*(.*?)\s*$/.exec(line);
    if (!field) continue;
    if (field[1] === "title") frontTitle = field[2].replace(/^(?:["'])(.*)(?:["'])$/, "$1").trim();
    if (field[1] === "tags") {
      const value = field[2].replace(/^\[(.*)\]$/, "$1");
      tags = [...new Set(value.split(",").map((tag) => tag.trim().replace(/^(?:["'])(.*)(?:["'])$/, "$1").toLowerCase()).filter(Boolean))].sort();
    }
  }
  const heading = content.split(/\r?\n/).find((line) => line.startsWith("# "));
  const title = frontTitle || (heading ? heading.slice(2).trim() : slug);
  return { slug, title, tags, body: content };
}

export function titleFor(slug, markdown) {
  return parsePage(slug, markdown).title;
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
