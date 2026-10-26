import { DatabaseSync } from "node:sqlite";

const MIGRATIONS = [
  `
    CREATE TABLE pages (
      slug TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL
    );
    CREATE TABLE page_tags (
      slug TEXT NOT NULL REFERENCES pages(slug) ON DELETE CASCADE,
      tag TEXT NOT NULL,
      PRIMARY KEY (slug, tag)
    );
    CREATE INDEX page_tags_tag_idx ON page_tags(tag);
    CREATE VIRTUAL TABLE pages_fts USING fts5(slug UNINDEXED, title, body);
  `,
];

function runMigrations(database) {
  database.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)");
  if (!database.prepare("SELECT version FROM schema_version LIMIT 1").get()) {
    database.prepare("INSERT INTO schema_version (version) VALUES (0)").run();
  }

  let version = database.prepare("SELECT version FROM schema_version LIMIT 1").get().version;
  for (let next = version + 1; next <= MIGRATIONS.length; next += 1) {
    database.exec("BEGIN");
    try {
      database.exec(MIGRATIONS[next - 1]);
      database.prepare("UPDATE schema_version SET version = ?").run(next);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
}

function searchTerms(query) {
  return [...new Set(query.match(/[\p{L}\p{N}]+/gu) ?? [])];
}

function makeSnippet(body, terms) {
  if (!body) return "";
  const matcher = new RegExp(terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "giu");
  const match = matcher.exec(body);
  const start = match ? Math.max(0, match.index - 60) : 0;
  const excerpt = body.slice(start, start + 180);
  const highlighted = excerpt.replace(matcher, (value) => `**${value}**`);
  return `${start > 0 ? "…" : ""}${highlighted}${start + 180 < body.length ? "…" : ""}`;
}

export class PageIndex {
  constructor(indexPath) {
    this.database = new DatabaseSync(indexPath);
    this.database.exec("PRAGMA foreign_keys = ON");
    runMigrations(this.database);
  }

  replaceAll(pages) {
    this.database.exec("BEGIN");
    try {
      this.database.exec("DELETE FROM page_tags; DELETE FROM pages_fts; DELETE FROM pages;");
      for (const page of pages) this.upsert(page, false);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  upsert(page, transaction = true) {
    if (transaction) this.database.exec("BEGIN");
    try {
      this.database.prepare("DELETE FROM page_tags WHERE slug = ?").run(page.slug);
      this.database.prepare("DELETE FROM pages_fts WHERE slug = ?").run(page.slug);
      this.database.prepare("INSERT INTO pages (slug, title, body) VALUES (?, ?, ?) ON CONFLICT(slug) DO UPDATE SET title = excluded.title, body = excluded.body").run(page.slug, page.title, page.body);
      this.database.prepare("INSERT INTO pages_fts (slug, title, body) VALUES (?, ?, ?)").run(page.slug, page.title, page.body);
      for (const tag of page.tags) this.database.prepare("INSERT INTO page_tags (slug, tag) VALUES (?, ?)").run(page.slug, tag);
      if (transaction) this.database.exec("COMMIT");
    } catch (error) {
      if (transaction) this.database.exec("ROLLBACK");
      throw error;
    }
  }

  remove(slug) {
    this.database.exec("BEGIN");
    try {
      this.database.prepare("DELETE FROM page_tags WHERE slug = ?").run(slug);
      this.database.prepare("DELETE FROM pages_fts WHERE slug = ?").run(slug);
      this.database.prepare("DELETE FROM pages WHERE slug = ?").run(slug);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  search(query) {
    const terms = searchTerms(query);
    if (!terms.length) return [];
    const match = terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(" AND ");
    const rows = this.database.prepare("SELECT slug, title, body, -bm25(pages_fts, 5.0, 1.0) AS score FROM pages_fts WHERE pages_fts MATCH ? ORDER BY bm25(pages_fts, 5.0, 1.0), slug LIMIT 20").all(match);
    return rows.map(({ slug, title, body, score }) => ({ slug, title, snippet: makeSnippet(body, terms), score: Number(score) }));
  }

  tags() {
    return this.database.prepare("SELECT tag, COUNT(*) AS count FROM page_tags GROUP BY tag ORDER BY count DESC, tag ASC").all().map(({ tag, count }) => ({ tag, count: Number(count) }));
  }

  pagesForTag(tag) {
    return this.database.prepare("SELECT p.slug, p.title FROM pages p JOIN page_tags t ON t.slug = p.slug WHERE t.tag = ? ORDER BY p.slug").all(tag.toLowerCase());
  }

  close() {
    this.database.close();
  }
}
